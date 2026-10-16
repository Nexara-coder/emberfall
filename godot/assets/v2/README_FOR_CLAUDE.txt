REALMFORGE HD ASSET PACK v2
Corrects v1's missing-UV defect. Every exported GLB was round-trip loaded and checked for UV coordinates on every mesh primitive.
Assign textures by semantic mesh names (trunk/foliage, roof/body, blade/handle, etc.). The adventurer is a UV-mapped base mesh, not a rigged production character; rig/skin/animate it during integration.
Keep authored towns and procedural natural scenery separate. Revalidate axes, scale, pivots, texture orientation and collision in the actual Realmforge renderer.
