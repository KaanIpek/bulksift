import ExpoModulesCore

/**
 The native half of card detection, exposed to JavaScript.

 The buffers are owned by the caller and passed in on every frame: JavaScript
 allocates them once and reuses them, so neither side allocates per frame. That
 matters more than it sounds - on iOS the whole engine runs on an interpreter
 with a garbage collector, and a megabyte of churn per frame was measurably
 worse than the arithmetic it was carrying.

 This is an accelerator, never a requirement. `index.ts` falls back to the
 TypeScript implementation whenever this module is missing, which is what keeps
 the web build and the desktop test suite working.
 */
public class BulkSiftDetectModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BulkSiftDetect")

    Function("run") { (
      src: Uint8Array,
      params: Int32Array,
      outGray: Float32Array,
      outMeta: Int32Array,
      outComps: Int32Array
    ) -> Int in
      let code = bulksift_detect_run(
        src.rawPointer.assumingMemoryBound(to: UInt8.self),
        Int32(src.length),
        params.rawPointer.assumingMemoryBound(to: Int32.self),
        Int32(params.length),
        outGray.rawPointer.assumingMemoryBound(to: Float.self),
        Int32(outGray.length),
        outMeta.rawPointer.assumingMemoryBound(to: Int32.self),
        Int32(outMeta.length),
        outComps.rawPointer.assumingMemoryBound(to: Int32.self),
        Int32(outComps.length)
      )
      return Int(code)
    }
  }
}
