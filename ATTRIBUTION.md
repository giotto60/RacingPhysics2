# Attribution

Third-party assets in `public/models/`. Everything else in this repository is
generated at runtime or authored here.

## Kenney Car Kit — `public/models/kenney/`

Twenty-five vehicles and one shared 12 KB palette texture, from Kenney's Car Kit
(version 3.1), <https://www.kenney.nl>.

Licensed **CC0 1.0 Universal** (public domain dedication): usable for personal,
educational and commercial purposes, with credit appreciated but not required.
The kit's own licence file is kept alongside the models at
`public/models/kenney/License.txt`.

The files are the kit's GLB exports, copied unmodified. Only the vehicles are
included; the kit's debris, cones, boxes and loose wheels are not used here.

## Pony Cartoon — `public/models/pony/pony.glb`

Supplied as an OBJ inside a solid RAR with a folder of 2048px PBR textures. It
is converted to a single GLB by `tools/pony_to_glb.py`, which rebuilds the
material assignment from the OBJ's `usemtl` groups (the MTL cannot be read out
of a solid archive without a RAR decoder), resizes the textures to 1024/512 and
embeds them. The baked ground-shadow quad is dropped.

**The upload carried no licence file.** This appears to be the "Pony Cartoon"
model published on Sketchfab by Slava Z., which is distributed under
**CC-BY-4.0** and so requires crediting the author. That has not been verified
against the original listing from here, so confirm the source and licence before
publishing this build anywhere public, and add the author's name to this file.
