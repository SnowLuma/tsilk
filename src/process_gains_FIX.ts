import { EncoderState, EncoderControl } from './structs';
import { 
    SKP_Silk_sigm_Q15, SKP_RSHIFT_ROUND as RSHIFT_ROUND, SKP_FIX_CONST, 
    SKP_SMLAWB as SMLAWB, SKP_DIV32_16, SKP_Silk_log2lin, SKP_SMULWB as SMULWB, 
    SKP_SMULWW as SMULWW, SKP_RSHIFT as RSHIFT, SKP_LSHIFT as LSHIFT, 
    SKP_ADD_SAT32, SKP_SMLAWW, SKP_Silk_SQRT_APPROX, SKP_LSHIFT_SAT32, SKP_SMULBB as SMULBB,
    SKP_SMMUL
} from './macros';
import { NB_SUBFR, SIG_TYPE_VOICED } from './defines';
import * as Tuning from './tuning_parameters';
import { SKP_Silk_Quantization_Offsets_Q10 } from './tables/tables_other';
import { gainsQuant } from './gain_quant';

export function process_gains_FIX(
    psEnc: EncoderState, 
    psEncCtrl: EncoderControl
): void {
    let psShapeSt = psEnc.sShape;
    let k: number;
    let s_Q16: number, InvMaxSqrVal_Q16: number, gain: number, gain_squared: number;
    let ResNrg: number, ResNrgPart: number, quant_offset_Q10: number;

    /* Gain reduction when LTP coding gain is high */
    if (psEncCtrl.sigtype == SIG_TYPE_VOICED) {
        /* s = -0.5f * SKP_sigmoid( 0.25f * ( psEncCtrl->LTPredCodGain - 12.0f ) ); */
        s_Q16 = -SKP_Silk_sigm_Q15( RSHIFT_ROUND( psEncCtrl.LTPredCodGain_Q7 - SKP_FIX_CONST( 12.0, 7 ), 4 ) );
        for (k = 0; k < NB_SUBFR; k++) {
            psEncCtrl.Gains_Q16[k] = SMLAWB( psEncCtrl.Gains_Q16[k], psEncCtrl.Gains_Q16[k], s_Q16 );
        }
    }

    /* Limit the quantized signal */
    InvMaxSqrVal_Q16 = SKP_DIV32_16( SKP_Silk_log2lin( 
        SMULWB( SKP_FIX_CONST( 70.0, 7 ) - psEncCtrl.current_SNR_dB_Q7, SKP_FIX_CONST( 0.33, 16 ) ) ), psEnc.subfr_length );

    for (k = 0; k < NB_SUBFR; k++) {
        /* Soft limit on ratio residual energy and squared gains */
        ResNrg     = psEncCtrl.ResNrg[k];
        ResNrgPart = SMULWW( ResNrg, InvMaxSqrVal_Q16 );
        if (psEncCtrl.ResNrgQ[k] > 0) {
            if (psEncCtrl.ResNrgQ[k] < 32) {
                ResNrgPart = RSHIFT_ROUND( ResNrgPart, psEncCtrl.ResNrgQ[k] );
            } else {
                ResNrgPart = 0;
            }
        } else if (psEncCtrl.ResNrgQ[k] !== 0) {
            if (ResNrgPart > RSHIFT( 2147483647, -psEncCtrl.ResNrgQ[k] )) {
                ResNrgPart = 2147483647;
            } else {
                ResNrgPart = LSHIFT( ResNrgPart, -psEncCtrl.ResNrgQ[k] );
            }
        }
        gain = psEncCtrl.Gains_Q16[k];
        gain_squared = SKP_ADD_SAT32( ResNrgPart, SKP_SMMUL( gain, gain ) );
        if (gain_squared < 32767) {
            /* recalculate with higher precision */
            gain_squared = SKP_SMLAWW( LSHIFT( ResNrgPart, 16 ), gain, gain );
            gain = SKP_Silk_SQRT_APPROX( gain_squared );                  /* Q8   */
            psEncCtrl.Gains_Q16[k] = SKP_LSHIFT_SAT32( gain, 8 );        /* Q16  */
        } else {
            gain = SKP_Silk_SQRT_APPROX( gain_squared );                  /* Q0   */
            psEncCtrl.Gains_Q16[k] = SKP_LSHIFT_SAT32( gain, 16 );       /* Q16  */
        }
    }

    /* Noise shaping quantization */
    const prev = { value: psShapeSt.LastGainIndex | 0 };
    gainsQuant(psEncCtrl.GainsIndices, psEncCtrl.Gains_Q16, prev, psEnc.nFramesInPayloadBuf > 0 ? 1 : 0);
    psShapeSt.LastGainIndex = prev.value;

    /* Set quantizer offset for voiced signals. Larger offset when LTP coding gain is low or tilt is high (ie low-pass) */
    if (psEncCtrl.sigtype == SIG_TYPE_VOICED) {
        if (psEncCtrl.LTPredCodGain_Q7 + RSHIFT( psEncCtrl.input_tilt_Q15, 8 ) > SKP_FIX_CONST( 1.0, 7 )) {
            psEncCtrl.QuantOffsetType = 0;
        } else {
            psEncCtrl.QuantOffsetType = 1;
        }
    }

    /* Quantizer boundary adjustment */
    quant_offset_Q10 = SKP_Silk_Quantization_Offsets_Q10[ psEncCtrl.sigtype ][ psEncCtrl.QuantOffsetType ];
    psEncCtrl.Lambda_Q10 = SKP_FIX_CONST( Tuning.LAMBDA_OFFSET, 10 )
                          + SMULBB( SKP_FIX_CONST( Tuning.LAMBDA_DELAYED_DECISIONS, 10 ), psEnc.nStatesDelayedDecision )
                          + SMULWB( SKP_FIX_CONST( Tuning.LAMBDA_SPEECH_ACT,        18 ), psEnc.speech_activity_Q8          )
                          + SMULWB( SKP_FIX_CONST( Tuning.LAMBDA_INPUT_QUALITY,     12 ), psEncCtrl.input_quality_Q14       )
                          + SMULWB( SKP_FIX_CONST( Tuning.LAMBDA_CODING_QUALITY,    12 ), psEncCtrl.coding_quality_Q14      )
                          + SMULWB( SKP_FIX_CONST( Tuning.LAMBDA_QUANT_OFFSET,      16 ), quant_offset_Q10                   );

}
