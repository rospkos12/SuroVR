// Tiny WebGL helper: shader compilation, program introspection, meshes.

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile failed: ' + log);
  }
  return shader;
}

// Links a program and returns { program, attribs, uniforms } with every
// active attribute / uniform location looked up by name.
export function createProgram(gl, vsSource, fsSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Program link failed: ' + gl.getProgramInfoLog(program));
  }
  const attribs = {}, uniforms = {};
  const nA = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < nA; i++) {
    const { name } = gl.getActiveAttrib(program, i);
    attribs[name] = gl.getAttribLocation(program, name);
  }
  const nU = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nU; i++) {
    const { name } = gl.getActiveUniform(program, i);
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, attribs, uniforms };
}

function buffer(gl, target, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(target, buf);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buf;
}

// geometry: { positions, normals?, indices?, mode? } as plain arrays.
export function createMesh(gl, { positions, normals, indices, mode = gl.TRIANGLES }) {
  return {
    mode,
    position: buffer(gl, gl.ARRAY_BUFFER, new Float32Array(positions)),
    normal: normals ? buffer(gl, gl.ARRAY_BUFFER, new Float32Array(normals)) : null,
    index: indices ? buffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)) : null,
    count: indices ? indices.length : positions.length / 3,
  };
}

// Binds a mesh to the program's aPosition / aNormal attributes and draws it.
export function drawMesh(gl, prog, mesh) {
  const { aPosition, aNormal } = prog.attribs;
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
  if (aNormal !== undefined) {
    if (mesh.normal) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(aNormal);
      gl.vertexAttrib3f(aNormal, 0, 1, 0); // constant "up" normal
    }
  }
  if (mesh.index) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
    gl.drawElements(mesh.mode, mesh.count, gl.UNSIGNED_SHORT, 0);
  } else {
    gl.drawArrays(mesh.mode, 0, mesh.count);
  }
}
