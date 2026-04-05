/**
 * SILK v3 TypeScript Codec - Public API
 *
 * Pure TypeScript implementation of the SILK v3 audio codec.
 * Supports decoding SILK v3 files (including Tencent variant) to PCM.
 *
 * Usage:
 *   import { decodeSilkFile, encodeSilkFile, SilkDecoder } from 'silk-ts';
 *
 *   // High-level file decode
 *   const pcm = decodeSilkFile(silkBuffer, 24000);
 *
 *   // Low-level decoder
 *   const decoder = new SilkDecoder();
 *   const result = decoder.decode(payload, payloadLen, decControl);
 */

// High-level API
export { decodeSilkFile, encodeSilkFile } from './silk_file';

// Core API
export { SilkDecoder } from './decoder';
export { SilkEncoder } from './encoder';


// Low-level decoder API
export { DecControlStruct, DecodeResult } from './decoder';

// Codec state types
export { DecoderState, DecoderControl, createDecoderControl } from './structs';
export { RangeCoderState } from './range_coder';

// Constants
export {
    SILK_V3_HEADER,
    SILK_V3_HEADER_TENCENT,
    MAX_FRAME_LENGTH,
    MAX_FS_KHZ,
    MAX_API_FS_KHZ,
    NB_SUBFR,
    MAX_LPC_ORDER,
    LTP_ORDER,
    SKP_SILK_NO_ERROR,
    SKP_SILK_DEC_PAYLOAD_ERROR,
    SKP_SILK_DEC_PAYLOAD_TOO_LARGE,
} from './defines';

// Utilities
export { resample } from './resampler';
