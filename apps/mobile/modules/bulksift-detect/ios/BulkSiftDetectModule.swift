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

    /*
     The index lives in native memory for the life of the process.

     Two megabytes held once beats handing 20,444 rows across the bridge on
     every query, and searching it is the stage an interpreter is worst at:
     pure integer XOR and population count, with nothing to inline away.
     */
    Function("loadIndex") { (data: Uint8Array) -> Int in
      Int(bulksift_index_load(
        data.rawPointer.assumingMemoryBound(to: UInt8.self),
        Int32(data.length)
      ))
    }

    Function("search") { (query: Uint8Array, out4: Int32Array) -> Bool in
      guard out4.length >= 4 else { return false }
      bulksift_index_search(
        query.rawPointer.assumingMemoryBound(to: UInt8.self),
        Int32(query.length),
        out4.rawPointer.assumingMemoryBound(to: Int32.self)
      )
      return true
    }

    /*
     Rectify and describe in one crossing.

     The canonical card is 322 KB and exists only to be reduced to 96 bytes, so
     it never leaves native memory. Turning it over for the flipped read happens
     there too, for the same reason.
     */
    Function("describe") { (
      src: Uint8Array,
      params: Int32Array,
      quad: Float64Array,
      flipped: Bool,
      outDesc: Uint8Array,
      outStrip: Uint8Array
    ) -> Int in
      Int(bulksift_describe_quad(
        src.rawPointer.assumingMemoryBound(to: UInt8.self),
        Int32(src.length),
        params.rawPointer.assumingMemoryBound(to: Int32.self),
        Int32(params.length),
        quad.rawPointer.assumingMemoryBound(to: Double.self),
        Int32(quad.length),
        flipped ? 1 : 0,
        outDesc.rawPointer.assumingMemoryBound(to: UInt8.self),
        Int32(outDesc.length),
        outStrip.rawPointer.assumingMemoryBound(to: UInt8.self),
        Int32(outStrip.length)
      ))
    }

    Function("stripDistance") { (row: Int, strip: Uint8Array) -> Int in
      Int(bulksift_index_strip_distance(
        Int32(row),
        strip.rawPointer.assumingMemoryBound(to: UInt8.self),
        Int32(strip.length)
      ))
    }

    Function("topK") { (query: Uint8Array, k: Int, outPairs: Int32Array) -> Int in
      Int(bulksift_index_topk(
        query.rawPointer.assumingMemoryBound(to: UInt8.self),
        Int32(query.length),
        Int32(k),
        outPairs.rawPointer.assumingMemoryBound(to: Int32.self),
        Int32(outPairs.length)
      ))
    }
  }
}
