import { FRAME_LENGTH_MS } from './defines';
import { SKP_max_int, SKP_RSHIFT_ROUND, SKP_RSHIFT, SKP_DIV32_16, SKP_min_int } from './macros';
import { SKP_Silk_sigm_Q15 } from './sigm_Q15';
import { SKP_Silk_LTPScales_table_Q14 } from './tables/index';

const NB_THRESHOLDS = 11;

const LTPScaleThresholds_Q15 = new Int16Array([
    31129, 26214, 16384, 13107, 9830, 6554,
     4915,  3276,  2621,  2458,    0
]);

export function SKP_Silk_LTP_scale_ctrl_FIX(
    psEnc: any,
    psEncCtrl: any
): void {
    let round_loss: number, frames_per_packet: number;
    let g_out_Q5: number, g_limit_Q15: number, thrld1_Q15: number, thrld2_Q15: number;

    frames_per_packet = 0;
    thrld1_Q15 = 0;
    thrld2_Q15 = 0;

    if (typeof psEnc.HPLTPredCodGain_Q7 !== 'number') psEnc.HPLTPredCodGain_Q7 = 0;
    if (typeof psEnc.prevLTPredCodGain_Q7 !== 'number') psEnc.prevLTPredCodGain_Q7 = 0;

    psEnc.HPLTPredCodGain_Q7 = SKP_max_int(psEncCtrl.LTPredCodGain_Q7 - psEnc.prevLTPredCodGain_Q7, 0)
        + SKP_RSHIFT_ROUND(psEnc.HPLTPredCodGain_Q7, 1);
    
    psEnc.prevLTPredCodGain_Q7 = psEncCtrl.LTPredCodGain_Q7;

    g_out_Q5 = SKP_RSHIFT_ROUND(SKP_RSHIFT(psEncCtrl.LTPredCodGain_Q7, 1) + SKP_RSHIFT(psEnc.HPLTPredCodGain_Q7, 1), 3);
    g_limit_Q15 = SKP_Silk_sigm_Q15(g_out_Q5 - (3 << 5));
            
    let LTP_scaleIndex = 0;

    round_loss = (psEnc.sCmn?.PacketLoss_perc ?? 0) | 0;

    if (psEnc.nFramesInPayloadBuf === 0) {
        frames_per_packet = SKP_DIV32_16(psEnc.PacketSize_ms, FRAME_LENGTH_MS);

        round_loss += frames_per_packet - 1;
        thrld1_Q15 = LTPScaleThresholds_Q15[SKP_min_int(round_loss, NB_THRESHOLDS - 1)];
        thrld2_Q15 = LTPScaleThresholds_Q15[SKP_min_int(round_loss + 1, NB_THRESHOLDS - 1)];
    
        if (g_limit_Q15 > thrld1_Q15) {
            LTP_scaleIndex = 2;
        } else if (g_limit_Q15 > thrld2_Q15) {
            LTP_scaleIndex = 1;
        }
    }

    psEncCtrl.LTP_scaleIndex = LTP_scaleIndex | 0;
    psEncCtrl.LTP_scale_Q14 = SKP_Silk_LTPScales_table_Q14[LTP_scaleIndex];
}
