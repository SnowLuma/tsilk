/** nlsf_cb1_16 codebook - Q15 combined */
import { nlsf_cb1_16_Q15_part0 } from './tables_nlsf_cb1_16_q15_p0';
import { nlsf_cb1_16_Q15_part1 } from './tables_nlsf_cb1_16_q15_p1';

export function build_nlsf_cb1_16_Q15(): Int16Array {
    const parts = [nlsf_cb1_16_Q15_part0, nlsf_cb1_16_Q15_part1];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Int16Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}
