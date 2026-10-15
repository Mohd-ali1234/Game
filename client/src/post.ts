// =====================================================================
// client/src/post.ts
// Post-processing ("camera effects") applied to the whole picture:
//   bloom on lights, film grain, vignette (dark corners), slight chromatic
//   aberration (colour fringes at the edges) and a muted, warm colour grade.
// Uses the "postprocessing" library, which merges all effects into a single
// pass, so it stays cheap on phones. Quality Low = no effects at all.
// =====================================================================
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import type { Quality } from './materials';

/** Muted, warm, slightly crushed "old photograph" look. */
class GradeEffect extends Effect {
  constructor() {
    super(
      'GradeEffect',
      /* glsl */ `
      uniform float saturation;
      uniform vec3 warmth;
      uniform float lift;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(l), c, saturation);          // less colourful
        c *= warmth;                               // warmer
        c = c * (1.0 - lift) + lift * vec3(0.06, 0.045, 0.03); // shadows never quite black, slightly brown
        outputColor = vec4(c, inputColor.a);
      }`,
      {
        uniforms: new Map<string, THREE.Uniform>([
          ['saturation', new THREE.Uniform(0.72)],
          ['warmth', new THREE.Uniform(new THREE.Vector3(1.06, 1.0, 0.86))],
          ['lift', new THREE.Uniform(0.025)],
        ]),
      },
    );
  }
}

export interface Post {
  render(dt: number): void;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: Quality): Post {
  if (quality === 'low') {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    return {
      render: () => renderer.render(scene, camera),
      setSize: () => {},
      dispose: () => {},
    };
  }
  // the composer does tone mapping itself (after bloom)
  renderer.toneMapping = THREE.NoToneMapping;
  const high = quality === 'high';
  const composer = new EffectComposer(renderer, { frameBufferType: high ? THREE.HalfFloatType : THREE.UnsignedByteType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({ intensity: high ? 1.1 : 0.9, luminanceThreshold: high ? 0.85 : 0.6, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 });
  bloom.resolution.scale = high ? 0.75 : 0.5;
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const grade = new GradeEffect();
  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.72 });
  const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  noise.blendMode.opacity.value = high ? 0.18 : 0.14;
  const chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0011, 0.0008), radialModulation: true, modulationOffset: 0.25 });

  // chromatic aberration has to be in its own pass (it re-reads the image)
  composer.addPass(new EffectPass(camera, bloom, tone, grade, vignette, noise));
  composer.addPass(new EffectPass(camera, chroma));

  return {
    render: (dt) => composer.render(dt),
    setSize: (w, h) => composer.setSize(w, h, false),
    dispose: () => composer.dispose(),
  };
}
