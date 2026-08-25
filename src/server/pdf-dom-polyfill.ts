type MatrixLike = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  m11: number;
  m12: number;
  m13: number;
  m14: number;
  m21: number;
  m22: number;
  m23: number;
  m24: number;
  m31: number;
  m32: number;
  m33: number;
  m34: number;
  m41: number;
  m42: number;
  m43: number;
  m44: number;
  is2D: boolean;
  isIdentity: boolean;
};

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

class NodeDOMMatrix implements MatrixLike {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  m11 = 1;
  m12 = 0;
  m13 = 0;
  m14 = 0;
  m21 = 0;
  m22 = 1;
  m23 = 0;
  m24 = 0;
  m31 = 0;
  m32 = 0;
  m33 = 1;
  m34 = 0;
  m41 = 0;
  m42 = 0;
  m43 = 0;
  m44 = 1;
  is2D = true;
  isIdentity = true;

  constructor(init?: unknown) {
    if (Array.isArray(init) || init instanceof Float32Array || init instanceof Float64Array) {
      if (init.length >= 16) {
        this.m11 = toNumber(init[0], 1);
        this.m12 = toNumber(init[1]);
        this.m13 = toNumber(init[2]);
        this.m14 = toNumber(init[3]);
        this.m21 = toNumber(init[4]);
        this.m22 = toNumber(init[5], 1);
        this.m23 = toNumber(init[6]);
        this.m24 = toNumber(init[7]);
        this.m31 = toNumber(init[8]);
        this.m32 = toNumber(init[9]);
        this.m33 = toNumber(init[10], 1);
        this.m34 = toNumber(init[11]);
        this.m41 = toNumber(init[12]);
        this.m42 = toNumber(init[13]);
        this.m43 = toNumber(init[14]);
        this.m44 = toNumber(init[15], 1);
        this.a = this.m11;
        this.b = this.m12;
        this.c = this.m21;
        this.d = this.m22;
        this.e = this.m41;
        this.f = this.m42;
        this.is2D = this.m13 === 0 && this.m14 === 0 && this.m23 === 0 && this.m24 === 0
          && this.m31 === 0 && this.m32 === 0 && this.m33 === 1 && this.m34 === 0 && this.m43 === 0 && this.m44 === 1;
      } else if (init.length >= 6) {
        this.a = toNumber(init[0], 1);
        this.b = toNumber(init[1]);
        this.c = toNumber(init[2]);
        this.d = toNumber(init[3], 1);
        this.e = toNumber(init[4]);
        this.f = toNumber(init[5]);
        this.m11 = this.a;
        this.m12 = this.b;
        this.m21 = this.c;
        this.m22 = this.d;
        this.m41 = this.e;
        this.m42 = this.f;
      }
    }
    this.syncIdentity();
  }

  private syncIdentity() {
    this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0
      && this.m33 === 1 && this.m44 === 1;
  }

  multiply(other: MatrixLike) {
    const next = new NodeDOMMatrix();
    next.a = this.a * other.a + this.c * other.b;
    next.b = this.b * other.a + this.d * other.b;
    next.c = this.a * other.c + this.c * other.d;
    next.d = this.b * other.c + this.d * other.d;
    next.e = this.a * other.e + this.c * other.f + this.e;
    next.f = this.b * other.e + this.d * other.f + this.f;
    next.m11 = next.a;
    next.m12 = next.b;
    next.m21 = next.c;
    next.m22 = next.d;
    next.m41 = next.e;
    next.m42 = next.f;
    next.syncIdentity();
    return next;
  }

  multiplySelf(other: MatrixLike) {
    const next = this.multiply(other);
    Object.assign(this, next);
    return this;
  }

  preMultiplySelf(other: MatrixLike) {
    const next = new NodeDOMMatrix([other.a, other.b, other.c, other.d, other.e, other.f]).multiply(this);
    Object.assign(this, next);
    return this;
  }

  translate(tx = 0, ty = 0) {
    return this.multiply(new NodeDOMMatrix([1, 0, 0, 1, tx, ty]));
  }

  translateSelf(tx = 0, ty = 0) {
    return this.multiplySelf(new NodeDOMMatrix([1, 0, 0, 1, tx, ty]));
  }

  scale(sx = 1, sy = sx) {
    return this.multiply(new NodeDOMMatrix([sx, 0, 0, sy, 0, 0]));
  }

  scaleSelf(sx = 1, sy = sx) {
    return this.multiplySelf(new NodeDOMMatrix([sx, 0, 0, sy, 0, 0]));
  }

  inverse() {
    const det = this.a * this.d - this.b * this.c;
    const next = new NodeDOMMatrix();
    if (!det) return next;
    next.a = this.d / det;
    next.b = -this.b / det;
    next.c = -this.c / det;
    next.d = this.a / det;
    next.e = (this.c * this.f - this.d * this.e) / det;
    next.f = (this.b * this.e - this.a * this.f) / det;
    next.m11 = next.a;
    next.m12 = next.b;
    next.m21 = next.c;
    next.m22 = next.d;
    next.m41 = next.e;
    next.m42 = next.f;
    next.syncIdentity();
    return next;
  }

  invertSelf() {
    const next = this.inverse();
    Object.assign(this, next);
    return this;
  }

  transformPoint(point: { x?: number; y?: number } = {}) {
    const x = toNumber(point.x);
    const y = toNumber(point.y);
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
      z: 0,
      w: 1,
    };
  }
}

class NodeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace = 'srgb';

  constructor(dataOrWidth: Uint8ClampedArray | number, width?: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = width || 0;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
      return;
    }
    this.data = dataOrWidth;
    this.width = width || 0;
    this.height = height ?? (this.width ? dataOrWidth.length / 4 / this.width : 0);
  }
}

class NodePath2D {
  addPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  arcTo() {}
  ellipse() {}
  rect() {}
}

export function installPdfDomPolyfills() {
  const globalRef = globalThis as typeof globalThis & {
    DOMMatrix?: unknown;
    ImageData?: unknown;
    Path2D?: unknown;
  };
  if (typeof globalRef.DOMMatrix === 'undefined') {
    globalRef.DOMMatrix = NodeDOMMatrix;
  }
  if (typeof globalRef.ImageData === 'undefined') {
    globalRef.ImageData = NodeImageData;
  }
  if (typeof globalRef.Path2D === 'undefined') {
    globalRef.Path2D = NodePath2D;
  }
}
