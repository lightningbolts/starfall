/** GLSL used by the Chronicle map. Kept apart so mapView.ts stays readable. */

const NOISE = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * valueNoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}
`;

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Baked once into a texture that covers the galaxy bounds: swirling dust with
 * a bright core, so empty space is not flat black.
 */
export const NEBULA_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uSeed;
uniform float uArms;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float ang = atan(p.y, p.x);

  vec2 q = p * 2.4 + vec2(uSeed, uSeed * 0.73);
  float warp = fbm(q + vec2(ang * 0.8, r * 2.0));
  float clouds = fbm(q * 2.1 + warp * 1.5);

  float mask = smoothstep(1.0, 0.1, r);
  // Bands follow the spiral arms so dust reads as structure, not fog.
  float arms = 0.5 + 0.5 * sin(ang * uArms + r * 7.5 - warp * 2.4);
  float density = clouds * mask * pow(arms, 1.8);

  vec3 cool = vec3(0.10, 0.20, 0.38);
  vec3 warm = vec3(0.28, 0.12, 0.22);
  vec3 col = mix(cool, warm, clamp(clouds * 0.8, 0.0, 1.0)) * pow(density, 2.1) * 1.5;

  float core = exp(-r * r * 80.0);
  col += vec3(0.34, 0.32, 0.44) * core * 0.28;

  gl_FragColor = vec4(col, 1.0);
}
`;

/** Cell fill pass: writes each empire's accent color and an owned flag. */
export const OWNER_VERT = /* glsl */ `
attribute vec4 aOwner;
varying vec4 vOwner;
void main() {
  vOwner = aOwner;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const OWNER_FRAG = /* glsl */ `
precision highp float;
varying vec4 vOwner;
void main() {
  gl_FragColor = vOwner;
}
`;

/**
 * Turns the hard-edged cell mosaic into empire blobs. Coverage is sampled over
 * a disc, so the interior fills smoothly and the 50% contour becomes a glowing
 * rim. Cell edges never appear because only coverage and the nearest owned
 * sample's color are used.
 */
export const TERRITORY_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uOwner;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uRimBoost;

void main() {
  float cov = 0.0;
  float wsum = 0.0;
  vec3 nearColor = vec3(0.0);
  float nearDist = 1e9;

  vec4 c0 = texture2D(uOwner, vUv);
  cov += c0.a;
  wsum += 1.0;
  if (c0.a > 0.5) {
    nearDist = 0.0;
    nearColor = c0.rgb;
  }

  for (int ring = 0; ring < 3; ring++) {
    float fr = (float(ring) + 1.0) / 3.0;
    float rad = uRadius * fr;
    float w = 2.0 * float(ring) + 1.0;
    for (int k = 0; k < 8; k++) {
      float ang = (float(k) + float(ring) * 0.5) * 0.7853981634;
      vec2 off = vec2(cos(ang), sin(ang)) * rad * uTexel;
      vec4 s = texture2D(uOwner, vUv + off);
      cov += s.a * w;
      wsum += w;
      if (s.a > 0.5 && rad < nearDist) {
        nearDist = rad;
        nearColor = s.rgb;
      }
    }
  }

  float c = cov / wsum;
  // Interior is a deep translucent wash; the rim is a narrow band on the 50%
  // coverage contour, which is what reads as an empire border.
  float interior = smoothstep(0.26, 0.62, c);
  float d = (c - 0.5) / 0.105;
  float rim = exp(-d * d);

  float alpha = clamp(interior * 0.66 + rim * 0.30, 0.0, 1.0);
  vec3 body = nearColor * (0.17 + 0.23 * interior);
  vec3 glow = nearColor * rim * uRimBoost;

  gl_FragColor = vec4(body * alpha + glow, alpha);
}
`;

/** Star sprites: per-vertex size and color, bright core with a soft halo. */
export const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize;
  gl_Position = projectionMatrix * mv;
}
`;

export const STAR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(1.0, 0.15, d);
  float halo = exp(-d * d * 2.6);
  vec3 col = vColor * (core * 1.25 + halo * 0.8);
  float a = clamp(core * 0.9 + halo * 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
}
`;

/** Capital markers: a thin ring so throneworlds read differently from stars. */
export const RING_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float ring = exp(-pow((d - 0.72) / 0.13, 2.0));
  float dot0 = smoothstep(0.34, 0.0, d);
  vec3 col = vColor * (ring * 1.4 + dot0 * 1.6);
  float a = clamp(ring * 0.95 + dot0, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
}
`;
