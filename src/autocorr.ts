import { SKP_min_int as min_int, toInt32 } from './macros';

export function inner_prod16_aligned_64(
    inputData1: Int16Array,
    offset1: number,
    inputData2: Int16Array,
    offset2: number,
    len: number
): number {
    let sum = 0;
    for (let i = 0; i < len; i++) {
        sum += inputData1[offset1 + i] * inputData2[offset2 + i];
    }
    return sum;
}

function CLZ64(val: number): number {
    if (val === 0) return 64;
    let n = 0;
    while (val > 0) {
        val = Math.floor(val / 2);
        n++;
    }
    return 64 - n;
}

export function autocorr(
    results: Int32Array,
    scale_obj: { val: number },
    inputData: Int16Array,
    inputDataOffset: number,
    inputDataSize: number,
    correlationCount: number
): void {
    let i: number, lz: number, nRightShifts: number, corrCount: number;
    let corr64: number;

    corrCount = Math.min(inputDataSize, correlationCount);

    corr64 = inner_prod16_aligned_64(inputData, inputDataOffset, inputData, inputDataOffset, inputDataSize);
    corr64 += 1;

    lz = CLZ64(corr64);
    nRightShifts = 35 - lz;
    scale_obj.val = nRightShifts;

    if (nRightShifts <= 0) {
        results[0] = toInt32(corr64 * Math.pow(2, -nRightShifts));

        for (i = 1; i < corrCount; i++) {
            let p = inner_prod16_aligned_64(inputData, inputDataOffset, inputData, inputDataOffset + i, inputDataSize - i);
            results[i] = toInt32(p * Math.pow(2, -nRightShifts));
        }
    } else {
        results[0] = toInt32(Math.floor(corr64 / Math.pow(2, nRightShifts)));

        for (i = 1; i < corrCount; i++) {
            let p = inner_prod16_aligned_64(inputData, inputDataOffset, inputData, inputDataOffset + i, inputDataSize - i);
            results[i] = toInt32(Math.floor(p / Math.pow(2, nRightShifts)));
        }
    }
}
