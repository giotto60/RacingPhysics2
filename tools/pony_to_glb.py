#!/usr/bin/env python3
"""
Convert the Pony Cartoon OBJ into a single self-contained GLB.

The model ships as a solid RAR containing `Pony_cartoon.obj` and its MTL, plus a
folder of 2048px PBR textures. The MTL cannot be read out of a solid archive
without a RAR decoder, and the textures are 5.8 MB of JPEG, so the material
assignment is rebuilt here from the OBJ's `usemtl` names and the textures are
resized on the way in.

Re-run it against a fresh download of the model with:

    python3 tools/pony_to_glb.py <obj> <textures-dir> <out.glb>

Nothing in the repository depends on it at build or run time; it exists so the
asset's provenance is reproducible.
"""
import base64
import json
import struct
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image

# usemtl name -> (base colour texture, size, normal texture, emissive texture)
MATERIALS = {
    "Body_SG1": dict(
        name="body",
        base=("Body_dDo_d_orange.jpeg", 1024),
        normal=("Body_dDo_n.jpg", 1024),
        emissive=("Body_illumination.jpeg", 512),
        roughness=0.45,
        metallic=0.15,
    ),
    "Interior_SG": dict(
        name="interior",
        base=("Interior_dDo_d_red.jpg", 512),
        roughness=0.85,
        metallic=0.0,
    ),
    # Glass: no texture in the set, and a transparent surface would fight the
    # shadow pass, so it is a dark opaque tint.
    "Windows_SG": dict(name="glass", colour=[0.07, 0.09, 0.12, 1.0], roughness=0.15, metallic=0.5),
}
DROP = {"Ground_SG"}  # a single quad carrying a baked shadow


def load_obj(path):
    positions, uvs, normals = [], [], []
    groups = {}
    current = None
    for line in Path(path).read_text().splitlines():
        if line.startswith("v "):
            positions.append([float(v) for v in line.split()[1:4]])
        elif line.startswith("vt "):
            uvs.append([float(v) for v in line.split()[1:3]])
        elif line.startswith("vn "):
            normals.append([float(v) for v in line.split()[1:4]])
        elif line.startswith("usemtl"):
            current = line.split()[1]
            groups.setdefault(current, [])
        elif line.startswith("f ") and current is not None:
            corners = []
            for token in line.split()[1:]:
                bits = (token.split("/") + ["", ""])[:3]
                corners.append(tuple(int(b) - 1 if b else -1 for b in bits))
            # Fan-triangulate: the file mixes triangles and quads.
            for i in range(1, len(corners) - 1):
                groups[current].extend([corners[0], corners[i], corners[i + 1]])
    return positions, uvs, normals, groups


def build_primitive(corners, positions, uvs, normals, scale):
    """Weld the OBJ's separate index streams into one interleaved vertex list."""
    lookup, verts, indices = {}, [], []
    for corner in corners:
        if corner not in lookup:
            lookup[corner] = len(verts)
            vi, ti, ni = corner
            verts.append(
                (
                    [c * scale for c in positions[vi]],
                    uvs[ti] if ti >= 0 and ti < len(uvs) else [0.0, 0.0],
                    normals[ni] if ni >= 0 and ni < len(normals) else [0.0, 1.0, 0.0],
                )
            )
        indices.append(lookup[corner])
    return verts, indices


def texture_bytes(directory, filename, size):
    image = Image.open(Path(directory) / filename).convert("RGB")
    image = image.resize((size, size), Image.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, "JPEG", quality=88, optimize=True)
    return buffer.getvalue()


def main(obj_path, textures_dir, out_path):
    positions, uvs, normals, groups = load_obj(obj_path)

    # The file is authored in centimetres and Z-forward. glTF is metres, and the
    # simulation's forward is -Z, so the model is turned to face the same way.
    scale = 0.01
    buffer = bytearray()
    views, accessors, meshes, materials, images, samplers, textures = [], [], [], [], [], [], []

    def add_view(payload, target=None):
        while len(buffer) % 4:
            buffer.append(0)
        offset = len(buffer)
        buffer.extend(payload)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        if target:
            view["target"] = target
        views.append(view)
        return len(views) - 1

    def add_accessor(view, component, kind, count, mn=None, mx=None):
        acc = {"bufferView": view, "componentType": component, "count": count, "type": kind}
        if mn:
            acc["min"], acc["max"] = mn, mx
        accessors.append(acc)
        return len(accessors) - 1

    def add_texture(filename, size):
        payload = texture_bytes(textures_dir, filename, size)
        view = add_view(payload)
        images.append({"bufferView": view, "mimeType": "image/jpeg"})
        textures.append({"source": len(images) - 1, "sampler": 0})
        return len(textures) - 1

    samplers.append({"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497})

    primitives = []
    for usemtl, corners in groups.items():
        if usemtl in DROP or usemtl not in MATERIALS:
            continue
        spec = MATERIALS[usemtl]
        verts, indices = build_primitive(corners, positions, uvs, normals, scale)

        pos = bytearray()
        uv = bytearray()
        nrm = bytearray()
        mn = [9e9] * 3
        mx = [-9e9] * 3
        for p, t, n in verts:
            # Turn the car through 180 degrees so its nose points down -Z.
            p = [-p[0], p[1], -p[2]]
            n = [-n[0], n[1], -n[2]]
            pos.extend(struct.pack("<3f", *p))
            uv.extend(struct.pack("<2f", t[0], 1.0 - t[1]))
            nrm.extend(struct.pack("<3f", *n))
            for i in range(3):
                mn[i] = min(mn[i], p[i])
                mx[i] = max(mx[i], p[i])
        idx = bytearray()
        for i in indices:
            idx.extend(struct.pack("<I", i))

        a_pos = add_accessor(add_view(pos, 34962), 5126, "VEC3", len(verts), mn, mx)
        a_uv = add_accessor(add_view(uv, 34962), 5126, "VEC2", len(verts))
        a_nrm = add_accessor(add_view(nrm, 34962), 5126, "VEC3", len(verts))
        a_idx = add_accessor(add_view(idx, 34963), 5125, "SCALAR", len(indices))

        pbr = {
            "baseColorFactor": spec.get("colour", [1, 1, 1, 1]),
            "metallicFactor": spec["metallic"],
            "roughnessFactor": spec["roughness"],
        }
        material = {"name": spec["name"], "pbrMetallicRoughness": pbr, "doubleSided": False}
        if "base" in spec:
            pbr["baseColorTexture"] = {"index": add_texture(*spec["base"])}
        if "normal" in spec:
            material["normalTexture"] = {"index": add_texture(*spec["normal"])}
        if "emissive" in spec:
            material["emissiveTexture"] = {"index": add_texture(*spec["emissive"])}
            material["emissiveFactor"] = [1, 1, 1]
        materials.append(material)

        primitives.append(
            {
                "attributes": {"POSITION": a_pos, "TEXCOORD_0": a_uv, "NORMAL": a_nrm},
                "indices": a_idx,
                "material": len(materials) - 1,
            }
        )
        print(f"  {usemtl:12s} -> {spec['name']:9s} {len(verts):5d} verts {len(indices)//3:5d} tris")

    meshes.append({"name": "body", "primitives": primitives})
    gltf = {
        "asset": {"version": "2.0", "generator": "pony_to_glb.py"},
        "scene": 0,
        "scenes": [{"nodes": [0], "name": "pony"}],
        "nodes": [{"name": "body", "mesh": 0}],
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(buffer)}],
        "images": images,
        "samplers": samplers,
        "textures": textures,
    }

    json_chunk = json.dumps(gltf, separators=(",", ":")).encode()
    json_chunk += b" " * (-len(json_chunk) % 4)
    bin_chunk = bytes(buffer) + b"\0" * (-len(buffer) % 4)
    glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(json_chunk) + 8 + len(bin_chunk))
    glb += struct.pack("<II", len(json_chunk), 0x4E4F534A) + json_chunk
    glb += struct.pack("<II", len(bin_chunk), 0x004E4942) + bin_chunk
    Path(out_path).write_bytes(glb)
    print(f"wrote {out_path} ({len(glb)/1024:.0f} KB)")


if __name__ == "__main__":
    main(*sys.argv[1:4])
