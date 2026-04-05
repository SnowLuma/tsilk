/** nlsf_cb0_16 codebook - Q15 combined */
import { nlsf_cb0_16_Q15_part0 } from './tables_nlsf_cb0_16_q15_p0';
import { nlsf_cb0_16_Q15_part1 } from './tables_nlsf_cb0_16_q15_p1';
import { nlsf_cb0_16_Q15_part2 } from './tables_nlsf_cb0_16_q15_p2';

export function build_nlsf_cb0_16_Q15(): Int16Array {
    const parts = [nlsf_cb0_16_Q15_part0, nlsf_cb0_16_Q15_part1, nlsf_cb0_16_Q15_part2];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Int16Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}
