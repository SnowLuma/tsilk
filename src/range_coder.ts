/**
 * SILK v3 Range Coder State
 * Ported from SKP_Silk_range_coder.c
 */
import {
    MAX_ARITHM_BYTES,
    RANGE_CODER_WRITE_BEYOND_BUFFER,
    RANGE_CODER_CDF_OUT_OF_RANGE,
    RANGE_CODER_DEC_PAYLOAD_TOO_LONG,
} from './defines';
import { SKP_Silk_CLZ32, SKP_MUL_uint, toUint32 } from './macros';

export class RangeCoderState {
    bufferLength: number = 0;
    bufferIx: number = 0;
    base_Q32: number = 0;      // unsigned 32-bit
    range_Q16: number = 0;     // unsigned 32-bit
    error: number = 0;
    buffer: Uint8Array = new Uint8Array(MAX_ARITHM_BYTES);
}

/** Initialize range encoder */
export function rangeEncInit(psRC: RangeCoderState): void {
    psRC.bufferLength = MAX_ARITHM_BYTES;
    psRC.range_Q16 = 0x0000FFFF;
    psRC.bufferIx = 0;
    psRC.base_Q32 = 0;
    psRC.error = 0;
}

/** Initialize range decoder */
export function rangeDecInit(
    psRC: RangeCoderState, buffer: Uint8Array, bufferLength: number
): void {
    if (bufferLength > MAX_ARITHM_BYTES || bufferLength < 0) {
        psRC.error = RANGE_CODER_DEC_PAYLOAD_TOO_LONG;
        return;
    }
    psRC.buffer.set(buffer.subarray(0, bufferLength));
    psRC.bufferLength = bufferLength;
    psRC.bufferIx = 0;
    psRC.base_Q32 = toUint32(
        (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3]
    );
    psRC.range_Q16 = 0x0000FFFF;
    psRC.error = 0;
}

export function rangeEncode(
    psRC: RangeCoderState,
    data: number,
    prob: Uint16Array | number[] | Int32Array
): void {
    if (psRC.error) return;

    if (!Number.isInteger(data) || data < 0 || (data + 1) >= prob.length) {
        psRC.error = RANGE_CODER_CDF_OUT_OF_RANGE;
        return;
    }

    let low_Q16 = prob[data] >>> 0;
    let high_Q16 = prob[data + 1] >>> 0;
    let base_tmp = psRC.base_Q32 >>> 0;
    
    let base_Q32 = (base_tmp + SKP_MUL_uint(psRC.range_Q16, low_Q16)) >>> 0;
    let range_Q32 = SKP_MUL_uint(psRC.range_Q16, high_Q16 - low_Q16) >>> 0;

    if (base_Q32 < base_tmp) {
        let bufferIx_tmp = psRC.bufferIx;
        while (true) {
            bufferIx_tmp--;
            const v = ((psRC.buffer[bufferIx_tmp] | 0) + 1) & 0xFF;
            psRC.buffer[bufferIx_tmp] = v;
            if (v !== 0) break;
        }
    }

    let range_Q16: number;
    if (range_Q32 & 0xFF000000) {
        range_Q16 = (range_Q32 >>> 16) >>> 0;
    } else {
        if (range_Q32 & 0xFFFF0000) {
            range_Q16 = (range_Q32 >>> 8) >>> 0;
        } else {
            range_Q16 = range_Q32;
            if (psRC.bufferIx >= psRC.bufferLength) {
                psRC.error = RANGE_CODER_WRITE_BEYOND_BUFFER;
                return;
            }
            psRC.buffer[psRC.bufferIx++] = (base_Q32 >>> 24) & 0xFF;
            base_Q32 = (base_Q32 << 8) >>> 0;
        }
        if (psRC.bufferIx >= psRC.bufferLength) {
            psRC.error = RANGE_CODER_WRITE_BEYOND_BUFFER;
            return;
        }
        psRC.buffer[psRC.bufferIx++] = (base_Q32 >>> 24) & 0xFF;
        base_Q32 = (base_Q32 << 8) >>> 0;
    }

    psRC.base_Q32 = base_Q32;
    psRC.range_Q16 = range_Q16;
}

export function rangeCoderGetLength(
    psRC: RangeCoderState,
    nBytes: { val: number }
): number {
    let nBits = (psRC.bufferIx << 3) + SKP_Silk_CLZ32(psRC.range_Q16 - 1) - 14;
    nBytes.val = (nBits + 7) >> 3;
    return nBits;
}

export function rangeEncWrapUp(psRC: RangeCoderState): void {
    let base_Q24 = (psRC.base_Q32 >>> 8) >>> 0;
    let nBytes = { val: 0 };
    let bits_in_stream = rangeCoderGetLength(psRC, nBytes);

    let bits_to_store = bits_in_stream - (psRC.bufferIx << 3);
    base_Q24 += (0x00800000 >>> (bits_to_store - 1)) >>> 0;
    base_Q24 &= (0xFFFFFFFF << (24 - bits_to_store)) >>> 0;
    base_Q24 >>>= 0;

    if (base_Q24 & 0x01000000) {
        let bufferIx_tmp = psRC.bufferIx;
        while ((++(psRC.buffer[--bufferIx_tmp]) & 0xFF) === 0);
    }

    if (psRC.bufferIx < psRC.bufferLength) {
        psRC.buffer[psRC.bufferIx++] = (base_Q24 >>> 16) & 0xFF;
        if (bits_to_store > 8) {
            if (psRC.bufferIx < psRC.bufferLength) {
                psRC.buffer[psRC.bufferIx++] = (base_Q24 >>> 8) & 0xFF;
            }
        }
    }

    if (bits_in_stream & 7) {
        let mask = 0xFF >> (bits_in_stream & 7);
        if (nBytes.val - 1 < psRC.bufferLength) {
            psRC.buffer[nBytes.val - 1] |= mask;
        }
    }
}
