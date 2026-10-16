/* Emberfall - GLB reader.
   The asset pack is static meshes with positions, normals and indices and
   nothing else, so a full glTF loader would be a large dependency for very
   little. This reads exactly what those files contain and hands back a
   THREE.BufferGeometry. Anything it does not understand it skips rather than
   throwing, so one odd file cannot stop the world loading. */
(function (g) {
  'use strict';
  var THREE = g.THREE;

  var COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
               5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  var NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

  function parse(buffer) {
    var dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB');
    var total = dv.getUint32(8, true);
    var off = 12, json = null, bin = null;
    while (off < total) {
      var len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      var slice = buffer.slice(off + 8, off + 8 + len);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(slice));
      else if (type === 0x004E4942) bin = slice;
      off += 8 + len;
      if (off % 4) off += 4 - (off % 4);
    }
    if (!json) throw new Error('GLB has no JSON chunk');
    return { json: json, bin: bin };
  }

  function readAccessor(json, bin, index) {
    var acc = json.accessors[index];
    if (!acc || acc.bufferView === undefined) return null;
    var view = json.bufferViews[acc.bufferView];
    var Ctor = COMP[acc.componentType];
    var n = NUM[acc.type] || 1;
    if (!Ctor) return null;
    var start = (view.byteOffset || 0) + (acc.byteOffset || 0);
    /* typed arrays need their natural alignment, so copy when it is off */
    var bytes = acc.count * n * Ctor.BYTES_PER_ELEMENT;
    if (start % Ctor.BYTES_PER_ELEMENT !== 0) {
      return new Ctor(bin.slice(start, start + bytes));
    }
    return new Ctor(bin, start, acc.count * n);
  }

  /* Returns a single merged BufferGeometry in the file's own coordinates. */
  function geometryFrom(buffer) {
    var p = parse(buffer);
    var json = p.json, bin = p.bin;
    if (!json.meshes || !json.meshes.length) return null;

    var pos = [], nor = [], uv = [], idx = [];
    var base = 0;

    json.meshes.forEach(function (mesh) {
      (mesh.primitives || []).forEach(function (prim) {
        if (!prim.attributes || prim.attributes.POSITION === undefined) return;
        var P = readAccessor(json, bin, prim.attributes.POSITION);
        if (!P) return;
        var N = prim.attributes.NORMAL !== undefined ? readAccessor(json, bin, prim.attributes.NORMAL) : null;
        var T = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(json, bin, prim.attributes.TEXCOORD_0) : null;
        var count = P.length / 3;
        for (var i = 0; i < P.length; i++) pos.push(P[i]);
        for (var j = 0; j < count * 3; j++) nor.push(N ? N[j] : 0);
        for (var k = 0; k < count * 2; k++) uv.push(T ? T[k] : 0);
        if (prim.indices !== undefined) {
          var I = readAccessor(json, bin, prim.indices);
          for (var m = 0; m < I.length; m++) idx.push(I[m] + base);
        } else {
          for (var q = 0; q < count; q++) idx.push(q + base);
        }
        base += count;
      });
    });
    if (!pos.length) return null;

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    var hasNormals = nor.some(function (v) { return v !== 0; });
    if (hasNormals) geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    else geo.computeVertexNormals();
    geo.computeBoundingBox();
    return geo;
  }

  /* Returns each primitive as its own geometry, so a model split into parts
     (trunk / leaves, walls / roof) can carry a different texture per part.
     geometryFrom merges everything into one mesh, which makes that impossible. */
  function primitivesFrom(buffer) {
    var p = parse(buffer);
    var json = p.json, bin = p.bin;
    var out = [];
    (json.meshes || []).forEach(function (mesh) {
      (mesh.primitives || []).forEach(function (prim) {
        if (!prim.attributes || prim.attributes.POSITION === undefined) return;
        var P = readAccessor(json, bin, prim.attributes.POSITION);
        if (!P) return;
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(P), 3));
        if (prim.attributes.NORMAL !== undefined) {
          var N = readAccessor(json, bin, prim.attributes.NORMAL);
          if (N) geo.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from(N), 3));
        }
        if (prim.attributes.TEXCOORD_0 !== undefined) {
          var T = readAccessor(json, bin, prim.attributes.TEXCOORD_0);
          if (T) geo.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from(T), 2));
        }
        if (prim.indices !== undefined) {
          var I = readAccessor(json, bin, prim.indices);
          geo.setIndex(Array.from(I));
        }
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.computeBoundingBox();
        out.push(geo);
      });
    });
    return out;
  }

  /* Loads a model as separate parts, normalised the same way as load():
     upright, centred on x/z, feet at y=0, optionally scaled to a height. */
  function loadParts(url, opts) {
    opts = opts || {};
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' (HTTP ' + r.status + ')');
      return r.arrayBuffer();
    }).then(function (buf) {
      var parts = primitivesFrom(buf);
      if (!parts.length) throw new Error(url + ' contained no geometry');
      if (opts.zUp !== false) parts.forEach(function (gp) { gp.rotateX(-Math.PI / 2); });
      /* one shared transform across all parts, so they stay assembled */
      var box = new THREE.Box3();
      parts.forEach(function (gp) { gp.computeBoundingBox(); box.union(gp.boundingBox); });
      var h = box.max.y - box.min.y;
      var k = (opts.height && h > 0.0001) ? opts.height / h : 1;
      var cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      parts.forEach(function (gp) {
        if (k !== 1) gp.scale(k, k, k);
        gp.translate(-cx * k, -box.min.y * k, -cz * k);
        gp.computeBoundingBox();
        gp.computeBoundingSphere();
      });
      return parts;
    });
  }

  /* Loads a .glb and normalises it for the game: the pack is authored Z-up,
     so it is rotated upright, dropped so its feet sit on y=0, centred on x/z,
     and optionally scaled to a target height. */
  function load(url, opts) {
    opts = opts || {};
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' (HTTP ' + r.status + ')');
      return r.arrayBuffer();
    }).then(function (buf) {
      var geo = geometryFrom(buf);
      if (!geo) throw new Error(url + ' contained no geometry');
      if (opts.zUp !== false) geo.rotateX(-Math.PI / 2);
      geo.computeBoundingBox();
      var bb = geo.boundingBox;
      var h = bb.max.y - bb.min.y;
      if (opts.height && h > 0.0001) {
        var k = opts.height / h;
        geo.scale(k, k, k);
        geo.computeBoundingBox();
        bb = geo.boundingBox;
      }
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      return geo;
    });
  }

  /* ------------------------------------------------------------- skinning
     The rigged characters carry a joint hierarchy, bind matrices, skin
     weights and animation clips. This builds a real THREE.SkinnedMesh and
     THREE.AnimationClip set from them, so the model is driven by its own
     skeleton rather than by hand-rotating limb groups. */

  var PATH_TRACK = {
    translation: { prop: '.position', Track: null },
    rotation:    { prop: '.quaternion', Track: null },
    scale:       { prop: '.scale', Track: null }
  };

  function buildNodes(json, bin) {
    var objs = (json.nodes || []).map(function (n) {
      var o = n.mesh !== undefined || n.skin !== undefined ? new THREE.Object3D() : new THREE.Bone();
      o.name = n.name || '';
      if (n.translation) o.position.fromArray(n.translation);
      if (n.rotation) o.quaternion.fromArray(n.rotation);
      if (n.scale) o.scale.fromArray(n.scale);
      if (n.matrix) {
        var mtx = new THREE.Matrix4().fromArray(n.matrix);
        mtx.decompose(o.position, o.quaternion, o.scale);
      }
      return o;
    });
    (json.nodes || []).forEach(function (n, i) {
      (n.children || []).forEach(function (c) { objs[i].add(objs[c]); });
    });
    return objs;
  }

  function skinnedGeometry(json, bin, prim) {
    var geo = new THREE.BufferGeometry();
    function attr(name, size) {
      if (prim.attributes[name] === undefined) return null;
      var a = readAccessor(json, bin, prim.attributes[name]);
      return a ? new THREE.BufferAttribute(a, size) : null;
    }
    var P = attr('POSITION', 3); if (!P) return null;
    geo.setAttribute('position', P);
    var N = attr('NORMAL', 3); if (N) geo.setAttribute('normal', N);
    var T = attr('TEXCOORD_0', 2); if (T) geo.setAttribute('uv', T);
    var J = attr('JOINTS_0', 4); if (J) geo.setAttribute('skinIndex', J);
    var Wt = attr('WEIGHTS_0', 4); if (Wt) geo.setAttribute('skinWeight', Wt);
    if (prim.indices !== undefined) {
      var I = readAccessor(json, bin, prim.indices);
      geo.setIndex(new THREE.BufferAttribute(I, 1));
    }
    if (!N) geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  function buildClips(json, bin, nodeObjs) {
    return (json.animations || []).map(function (anim, ai) {
      var tracks = [];
      (anim.channels || []).forEach(function (ch) {
        var sampler = anim.samplers[ch.sampler];
        if (!sampler || ch.target.node === undefined) return;
        var target = nodeObjs[ch.target.node];
        if (!target) return;
        var times = readAccessor(json, bin, sampler.input);
        var values = readAccessor(json, bin, sampler.output);
        if (!times || !values) return;
        var name = target.name || ('node' + ch.target.node);
        var path = ch.target.path;
        try {
          if (path === 'rotation') {
            tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, values));
          } else if (path === 'translation') {
            tracks.push(new THREE.VectorKeyframeTrack(name + '.position', times, values));
          } else if (path === 'scale') {
            tracks.push(new THREE.VectorKeyframeTrack(name + '.scale', times, values));
          }
        } catch (e) {}
      });
      return tracks.length ? new THREE.AnimationClip(anim.name || ('clip' + ai), -1, tracks) : null;
    }).filter(Boolean);
  }

  /* Loads a rigged character. Returns { root, mesh, skeleton, clips, sockets }
     where sockets maps the attachment bone names to their Bone objects. */
  function loadRigged(url, opts) {
    opts = opts || {};
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' (HTTP ' + r.status + ')');
      return r.arrayBuffer();
    }).then(function (buf) {
      var p = parse(buf);
      var json = p.json, bin = p.bin;
      var nodeObjs = buildNodes(json, bin);

      var root = new THREE.Group();
      var scene = json.scenes && json.scenes[json.scene || 0];
      (scene && scene.nodes ? scene.nodes : nodeObjs.map(function (_, i) { return i; }))
        .forEach(function (i) { if (nodeObjs[i] && !nodeObjs[i].parent) root.add(nodeObjs[i]); });

      /* find the skinned mesh */
      var skinnedMesh = null, skeleton = null;
      (json.nodes || []).forEach(function (n, i) {
        if (n.mesh === undefined || n.skin === undefined) return;
        var mesh = json.meshes[n.mesh];
        var prim = mesh.primitives[0];
        var geo = skinnedGeometry(json, bin, prim);
        if (!geo) return;
        var skin = json.skins[n.skin];
        var bones = skin.joints.map(function (j) { return nodeObjs[j]; });
        var ibmArr = skin.inverseBindMatrices !== undefined
          ? readAccessor(json, bin, skin.inverseBindMatrices) : null;
        var boneInverses = bones.map(function (_, bi) {
          var mtx = new THREE.Matrix4();
          if (ibmArr) mtx.fromArray(ibmArr, bi * 16);
          return mtx;
        });
        skeleton = new THREE.Skeleton(bones, boneInverses);
        var mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        skinnedMesh = new THREE.SkinnedMesh(geo, mat);
        skinnedMesh.name = n.name || 'body';
        var holder = nodeObjs[i];
        holder.add(skinnedMesh);
        skinnedMesh.bind(skeleton, new THREE.Matrix4());
        skinnedMesh.frustumCulled = false;
      });
      if (!skinnedMesh) throw new Error(url + ' has no skinned mesh');

      var clips = buildClips(json, bin, nodeObjs);
      var sockets = {};
      nodeObjs.forEach(function (o) {
        if (o && o.name && o.name.indexOf('socket') >= 0) sockets[o.name] = o;
      });

      /* Axis conversion is opt-in for rigs. Emberfall's current character
         skeletons are Y-up, while several older static assets are Z-up. */
      if (opts.zUp === true) root.rotation.x = -Math.PI / 2;

      /* scale to a target height using the bind-pose bounds */
      if (opts.height) {
        root.updateMatrixWorld(true);
        var box = new THREE.Box3().setFromObject(root);
        var h = box.max.y - box.min.y;
        if (h > 0.001) {
          var k = opts.height / h;
          root.scale.setScalar(k);
          root.updateMatrixWorld(true);
          box = new THREE.Box3().setFromObject(root);
          root.position.y -= box.min.y;
        }
      }
      return { root: root, mesh: skinnedMesh, skeleton: skeleton, clips: clips, sockets: sockets };
    });
  }

  /* Every actor needs its OWN skeleton - sharing one rig between the player
     and every NPC would have them all move as a single puppet. This clones the
     bone hierarchy and rebinds a new SkinnedMesh to it, while still sharing
     the geometry and the clips, which are read-only. */
  function cloneRig(src) {
    var root = src.root.clone(true);
    /* map cloned bones by name, in the original joint order */
    var byName = {};
    root.traverse(function (o) { if (o.name) byName[o.name] = o; });
    var bones = src.skeleton.bones.map(function (b) { return byName[b.name] || b.clone(); });
    var inverses = src.skeleton.boneInverses.map(function (m) { return m.clone(); });
    var skeleton = new THREE.Skeleton(bones, inverses);

    /* find the cloned skinned mesh and rebind it */
    var mesh = null;
    root.traverse(function (o) { if (o.isSkinnedMesh && !mesh) mesh = o; });
    if (!mesh) {
      /* clone() does not always preserve the SkinnedMesh type; rebuild it */
      var holder = byName[src.mesh.parent && src.mesh.parent.name] || root;
      mesh = new THREE.SkinnedMesh(src.mesh.geometry, src.mesh.material);
      mesh.name = src.mesh.name;
      holder.add(mesh);
    } else {
      mesh.geometry = src.mesh.geometry;
      mesh.material = src.mesh.material;
    }
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;

    var sockets = {};
    Object.keys(src.sockets).forEach(function (k) { if (byName[k]) sockets[k] = byName[k]; });
    return { root: root, mesh: mesh, skeleton: skeleton, clips: src.clips, sockets: sockets };
  }

  g.RFGlb = { load: load, loadParts: loadParts, primitivesFrom: primitivesFrom,
              loadRigged: loadRigged, cloneRig: cloneRig, geometryFrom: geometryFrom, parse: parse };
})(window);
