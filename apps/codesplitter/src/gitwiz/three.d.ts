// three.js is a dependency of the game (city.js) but ships no types, and gitwiz is the only TypeScript that
// imports it. These are loose stand-ins for the few names gitwiz uses (any members, any arguments) rather than
// a new dev dependency (@types/three) for one scene. Add a name here when gitwiz starts using another.
declare module "three" {
  export class AmbientLight { constructor(...args: any[]); [key: string]: any }
  export class Box3 { constructor(...args: any[]); [key: string]: any }
  export class BoxGeometry { constructor(...args: any[]); [key: string]: any }
  export class BufferGeometry { constructor(...args: any[]); [key: string]: any }
  export class CapsuleGeometry { constructor(...args: any[]); [key: string]: any }
  export class CircleGeometry { constructor(...args: any[]); [key: string]: any }
  export class Color { constructor(...args: any[]); [key: string]: any }
  export class CylinderGeometry { constructor(...args: any[]); [key: string]: any }
  export class DirectionalLight { constructor(...args: any[]); [key: string]: any }
  export class Float32BufferAttribute { constructor(...args: any[]); [key: string]: any }
  export class Fog { constructor(...args: any[]); [key: string]: any }
  export class Group { constructor(...args: any[]); [key: string]: any }
  export class HemisphereLight { constructor(...args: any[]); [key: string]: any }
  export class Material { constructor(...args: any[]); [key: string]: any }
  export class Mesh { constructor(...args: any[]); [key: string]: any }
  export class MeshBasicMaterial { constructor(...args: any[]); [key: string]: any }
  export class MeshLambertMaterial { constructor(...args: any[]); [key: string]: any }
  export class Object3D { constructor(...args: any[]); [key: string]: any }
  export class OctahedronGeometry { constructor(...args: any[]); [key: string]: any }
  export class PerspectiveCamera { constructor(...args: any[]); [key: string]: any }
  export class Scene { constructor(...args: any[]); [key: string]: any }
  export class SphereGeometry { constructor(...args: any[]); [key: string]: any }
  export class Texture { constructor(...args: any[]); [key: string]: any }
  export class TextureLoader { constructor(...args: any[]); [key: string]: any }
  export class TorusGeometry { constructor(...args: any[]); [key: string]: any }
  export class Vector3 { constructor(...args: any[]); [key: string]: any }
  export class WebGLRenderer { constructor(...args: any[]); [key: string]: any }
  export const DoubleSide: any;
  export const SRGBColorSpace: any;
}
