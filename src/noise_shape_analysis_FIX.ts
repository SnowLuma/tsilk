import {
  SKP_SMLAWB as SMLAWB,
  SKP_SMLAWW as SMLAWW,
  SKP_SMULWB as SMULWB,
  SKP_SMULWW as SMULWW,
  SKP_DIV32_varQ,
  SKP_max_int as max_int,
  SKP_SAT16,
  SKP_RSHIFT_ROUND as RSHIFT_ROUND,
  SKP_SMLABB as SMLABB,
  SKP_SMULBB as SMULBB,
  SKP_FIX_CONST,
  SKP_Silk_lin2log,
  SKP_Silk_log2lin,
  SKP_Silk_sigm_Q15,
  SKP_LSHIFT as LSHIFT,
  SKP_RSHIFT as RSHIFT,
  SKP_ADD_SAT32 as ADD_SAT32,
  SKP_ADD_POS_SAT32 as ADD_POS_SAT32,
  SKP_MUL,
  SKP_min,
  SKP_max,
  SKP_abs,
  SKP_abs_int32 as abs_int32,
  SKP_Silk_sum_sqr_shift,
  SKP_INVERSE32_varQ,
  SKP_DIV32_16,
  SKP_LSHIFT_SAT32,
  SKP_Silk_SQRT_APPROX,
  SKP_MLA,
} from "./macros";
import {
  MAX_SHAPE_LPC_ORDER,
  SHAPE_LPC_WIN_MAX,
  NB_SUBFR,
  FRAME_LENGTH_MS,
  SIG_TYPE_VOICED,
  SIG_TYPE_UNVOICED,
} from "./defines";
import { applySineWindow } from "./apply_sine_window";
import { autocorr } from "./autocorr";
import { SKP_Silk_warped_autocorrelation_FIX } from "./warped_autocorrelation";
import { schur64 } from "./schur64";
import { k2a_Q16 } from "./k2a_Q16";
import { SKP_Silk_bwexpander } from "./macros"; // Need bwexpander_32
import { EncoderState, EncoderControl } from "./structs";
import * as Tuning from "./tuning_parameters";
import { LPC_inverse_pred_gain_Q24 } from "./lpc_inv_pred_gain";
import { SKP_Silk_bwexpander_32 } from "./bwexpander";

function warped_gain(
  coefs_Q24: Int32Array,
  lambda_Q16: number,
  order: number,
): number {
  let i: number;
  let gain_Q24: number;

  lambda_Q16 = -lambda_Q16;
  gain_Q24 = coefs_Q24[order - 1];
  for (i = order - 2; i >= 0; i--) {
    gain_Q24 = SMLAWB(coefs_Q24[i], gain_Q24, lambda_Q16);
  }
  gain_Q24 = SMLAWB(SKP_FIX_CONST(1.0, 24), gain_Q24, -lambda_Q16);
  return SKP_INVERSE32_varQ(gain_Q24, 40);
}

export function limit_warped_coefs(
  coefs_syn_Q24: Int32Array,
  coefs_ana_Q24: Int32Array,
  lambda_Q16: number,
  limit_Q24: number,
  order: number,
): void {
  let i,
    iter,
    ind = 0;
  let tmp, maxabs_Q24, chirp_Q16, gain_syn_Q16, gain_ana_Q16;
  let nom_Q16, den_Q24;

  lambda_Q16 = -lambda_Q16;
  for (i = order - 1; i > 0; i--) {
    coefs_syn_Q24[i - 1] = SMLAWB(
      coefs_syn_Q24[i - 1],
      coefs_syn_Q24[i],
      lambda_Q16,
    );
    coefs_ana_Q24[i - 1] = SMLAWB(
      coefs_ana_Q24[i - 1],
      coefs_ana_Q24[i],
      lambda_Q16,
    );
  }
  lambda_Q16 = -lambda_Q16;
  nom_Q16 = SMLAWB(SKP_FIX_CONST(1.0, 16), -lambda_Q16, lambda_Q16);
  den_Q24 = SMLAWB(SKP_FIX_CONST(1.0, 24), coefs_syn_Q24[0], lambda_Q16);
  gain_syn_Q16 = SKP_DIV32_varQ(nom_Q16, den_Q24, 24);
  den_Q24 = SMLAWB(SKP_FIX_CONST(1.0, 24), coefs_ana_Q24[0], lambda_Q16);
  gain_ana_Q16 = SKP_DIV32_varQ(nom_Q16, den_Q24, 24);

  for (i = 0; i < order; i++) {
    coefs_syn_Q24[i] = SMULWW(gain_syn_Q16, coefs_syn_Q24[i]);
    coefs_ana_Q24[i] = SMULWW(gain_ana_Q16, coefs_ana_Q24[i]);
  }

  for (iter = 0; iter < 10; iter++) {
    maxabs_Q24 = -1;
    for (i = 0; i < order; i++) {
      tmp = Math.max(Math.abs(coefs_syn_Q24[i]), Math.abs(coefs_ana_Q24[i]));
      if (tmp > maxabs_Q24) {
        maxabs_Q24 = tmp;
        ind = i;
      }
    }
    if (maxabs_Q24 <= limit_Q24) {
      return;
    }

    for (i = 1; i < order; i++) {
      coefs_syn_Q24[i - 1] = SMLAWB(
        coefs_syn_Q24[i - 1],
        coefs_syn_Q24[i],
        lambda_Q16,
      );
      coefs_ana_Q24[i - 1] = SMLAWB(
        coefs_ana_Q24[i - 1],
        coefs_ana_Q24[i],
        lambda_Q16,
      );
    }
    gain_syn_Q16 = SKP_INVERSE32_varQ(gain_syn_Q16, 32);
    gain_ana_Q16 = SKP_INVERSE32_varQ(gain_ana_Q16, 32);
    for (i = 0; i < order; i++) {
      coefs_syn_Q24[i] = SMULWW(gain_syn_Q16, coefs_syn_Q24[i]);
      coefs_ana_Q24[i] = SMULWW(gain_ana_Q16, coefs_ana_Q24[i]);
    }

    chirp_Q16 =
      SKP_FIX_CONST(0.99, 16) -
      SKP_DIV32_varQ(
        SMULWB(
          maxabs_Q24 - limit_Q24,
          SMLABB(SKP_FIX_CONST(0.8, 10), SKP_FIX_CONST(0.1, 10), iter),
        ),
        SKP_MUL(maxabs_Q24, ind + 1),
        22,
      );
    SKP_Silk_bwexpander_32(coefs_syn_Q24, order, chirp_Q16);
    SKP_Silk_bwexpander_32(coefs_ana_Q24, order, chirp_Q16);

    lambda_Q16 = -lambda_Q16;
    for (i = order - 1; i > 0; i--) {
      coefs_syn_Q24[i - 1] = SMLAWB(
        coefs_syn_Q24[i - 1],
        coefs_syn_Q24[i],
        lambda_Q16,
      );
      coefs_ana_Q24[i - 1] = SMLAWB(
        coefs_ana_Q24[i - 1],
        coefs_ana_Q24[i],
        lambda_Q16,
      );
    }
    lambda_Q16 = -lambda_Q16;
    nom_Q16 = SMLAWB(SKP_FIX_CONST(1.0, 16), -lambda_Q16, lambda_Q16);
    den_Q24 = SMLAWB(SKP_FIX_CONST(1.0, 24), coefs_syn_Q24[0], lambda_Q16);
    gain_syn_Q16 = SKP_DIV32_varQ(nom_Q16, den_Q24, 24);
    den_Q24 = SMLAWB(SKP_FIX_CONST(1.0, 24), coefs_ana_Q24[0], lambda_Q16);
    gain_ana_Q16 = SKP_DIV32_varQ(nom_Q16, den_Q24, 24);
    for (i = 0; i < order; i++) {
      coefs_syn_Q24[i] = SMULWW(gain_syn_Q16, coefs_syn_Q24[i]);
      coefs_ana_Q24[i] = SMULWW(gain_ana_Q16, coefs_ana_Q24[i]);
    }
  }
}

export function SKP_Silk_noise_shape_analysis_FIX(
  psEnc: EncoderState,
  psEncCtrl: EncoderControl,
  pitch_res: Int16Array,
  pitch_res_offset: number,
  x: Int16Array,
  x_offset: number,
): void {
  let psShapeSt = psEnc.sShape;
  let k, i, nSamples, Qnrg = 0, b_Q14, warping_Q16;
  let scale_obj = { val: 0 };
  let SNR_adj_dB_Q7, HarmBoost_Q16, HarmShapeGain_Q16, Tilt_Q16, tmp32 = 0;
  let nrg_obj = { val: 0 };
  let pre_nrg_Q30_obj = { val: 0 };
  let log_energy_Q7, log_energy_prev_Q7, energy_variation_Q7;
  let delta_Q16,
    BWExp1_Q16,
    BWExp2_Q16,
    gain_mult_Q16,
    gain_add_Q16,
    strength_Q16,
    b_Q8;

  let auto_corr = new Int32Array(MAX_SHAPE_LPC_ORDER + 1);
  let refl_coef_Q16 = new Int32Array(MAX_SHAPE_LPC_ORDER);
  let AR1_Q24 = new Int32Array(MAX_SHAPE_LPC_ORDER);
  let AR2_Q24 = new Int32Array(MAX_SHAPE_LPC_ORDER);
  let x_windowed = new Int16Array(SHAPE_LPC_WIN_MAX);

  let x_ptr_offset = x_offset - psEnc.la_shape;

  // Control SNR with buffer/FEC penalties.
  const baseSNR_Q7 =
    ((psEnc as any).SNR_dB_Q7 ?? psEncCtrl.current_SNR_dB_Q7) | 0;
  psEncCtrl.current_SNR_dB_Q7 =
    baseSNR_Q7 -
    SMULWB(LSHIFT(psEnc.BufferedInChannel_ms | 0, 7), SKP_FIX_CONST(0.05, 16));

  if (
    psEnc.speech_activity_Q8 >
    SKP_FIX_CONST(Tuning.LBRR_SPEECH_ACTIVITY_THRES, 8)
  ) {
    const fecComp_Q8 = ((psEnc as any).inBandFEC_SNR_comp_Q8 ?? 0) | 0;
    psEncCtrl.current_SNR_dB_Q7 -= RSHIFT(fecComp_Q8, 1);
  }

  // Input/coding quality.
  psEncCtrl.input_quality_Q14 = RSHIFT(
    (psEncCtrl.input_quality_bands_Q15[0] +
      psEncCtrl.input_quality_bands_Q15[1]) |
      0,
    2,
  );
  psEncCtrl.coding_quality_Q14 = RSHIFT(
    SKP_Silk_sigm_Q15(
      RSHIFT_ROUND(psEncCtrl.current_SNR_dB_Q7 - SKP_FIX_CONST(18.0, 7), 4),
    ),
    1,
  );

  // Speech activity based SNR adjustment.
  b_Q8 = SKP_FIX_CONST(1.0, 8) - psEnc.speech_activity_Q8;
  b_Q8 = SMULWB(LSHIFT(b_Q8, 8), b_Q8);
  SNR_adj_dB_Q7 = SMLAWB(
    psEncCtrl.current_SNR_dB_Q7,
    SMULBB(SKP_FIX_CONST(-Tuning.BG_SNR_DECR_dB, 7) >> 5, b_Q8),
    SMULWB(
      SKP_FIX_CONST(1.0, 14) + psEncCtrl.input_quality_Q14,
      psEncCtrl.coding_quality_Q14,
    ),
  );

  if (psEncCtrl.sigtype === SIG_TYPE_VOICED) {
    SNR_adj_dB_Q7 = SMLAWB(
      SNR_adj_dB_Q7,
      SKP_FIX_CONST(Tuning.HARM_SNR_INCR_dB, 8),
      psEnc.LTPCorr_Q15,
    );
    psEncCtrl.QuantOffsetType = 0;
    (psEncCtrl as any).sparseness_Q8 = 0;
  } else {
    SNR_adj_dB_Q7 = SMLAWB(
      SNR_adj_dB_Q7,
      SMLAWB(
        SKP_FIX_CONST(6.0, 9),
        -SKP_FIX_CONST(0.4, 18),
        psEncCtrl.current_SNR_dB_Q7,
      ),
      SKP_FIX_CONST(1.0, 14) - psEncCtrl.input_quality_Q14,
    );

    // Sparseness from 2 ms residual-energy fluctuations.
    nSamples = LSHIFT(psEnc.fs_kHz, 1);
    energy_variation_Q7 = 0;
    log_energy_prev_Q7 = 0;
    let pitch_res_ptr = pitch_res_offset;
    for (k = 0; k < FRAME_LENGTH_MS / 2; k++) {
      SKP_Silk_sum_sqr_shift(
        nrg_obj,
        scale_obj,
        pitch_res.subarray(pitch_res_ptr),
        nSamples,
      );
      let nrgLocal = nrg_obj.val + RSHIFT(nSamples, scale_obj.val);
      log_energy_Q7 = SKP_Silk_lin2log(Math.max(nrgLocal, 1));
      if (k > 0) {
        energy_variation_Q7 += SKP_abs(log_energy_Q7 - log_energy_prev_Q7);
      }
      log_energy_prev_Q7 = log_energy_Q7;
      pitch_res_ptr += nSamples;
    }

    const sparseness_Q8 = RSHIFT(
      SKP_Silk_sigm_Q15(
        SMULWB(
          energy_variation_Q7 - SKP_FIX_CONST(5.0, 7),
          SKP_FIX_CONST(0.1, 16),
        ),
      ),
      7,
    );
    (psEncCtrl as any).sparseness_Q8 = sparseness_Q8;
    psEncCtrl.QuantOffsetType =
      sparseness_Q8 > SKP_FIX_CONST(Tuning.SPARSENESS_THRESHOLD_QNT_OFFSET, 8)
        ? 0
        : 1;
    SNR_adj_dB_Q7 = SMLAWB(
      SNR_adj_dB_Q7,
      SKP_FIX_CONST(Tuning.SPARSE_SNR_INCR_dB, 15),
      sparseness_Q8 - SKP_FIX_CONST(0.5, 8),
    );
  }

  // Bandwidth expansion control.
  strength_Q16 = SMULWB(
    psEncCtrl.predGain_Q16,
    SKP_FIX_CONST(Tuning.FIND_PITCH_WHITE_NOISE_FRACTION, 16),
  );
  BWExp1_Q16 = BWExp2_Q16 = SKP_DIV32_varQ(
    SKP_FIX_CONST(Tuning.BANDWIDTH_EXPANSION, 16),
    SMLAWW(SKP_FIX_CONST(1.0, 16), strength_Q16, strength_Q16),
    16,
  );
  delta_Q16 = SMULWB(
    SKP_FIX_CONST(1.0, 16) - SMULBB(3, psEncCtrl.coding_quality_Q14),
    SKP_FIX_CONST(Tuning.LOW_RATE_BANDWIDTH_EXPANSION_DELTA, 16),
  );
  BWExp1_Q16 -= delta_Q16;
  BWExp2_Q16 += delta_Q16;
  BWExp1_Q16 = SKP_DIV32_16(LSHIFT(BWExp1_Q16, 14), RSHIFT(BWExp2_Q16, 2));

  warping_Q16 =
    psEnc.warping_Q16 > 0
      ? SMLAWB(
          psEnc.warping_Q16,
          psEncCtrl.coding_quality_Q14,
          SKP_FIX_CONST(0.01, 18),
        )
      : 0;

  // Compute shaping AR coefficients and gains for each subframe.
  for (k = 0; k < NB_SUBFR; k++) {
    const flat_part = psEnc.fs_kHz * 5;
    const slope_part = RSHIFT(psEnc.shapeWinLength - flat_part, 1);

    applySineWindow(x_windowed, 0, x, x_ptr_offset, 1, slope_part);
    for (i = 0; i < flat_part; i++) {
      x_windowed[slope_part + i] = x[x_ptr_offset + slope_part + i];
    }
    applySineWindow(
      x_windowed,
      slope_part + flat_part,
      x,
      x_ptr_offset + slope_part + flat_part,
      2,
      slope_part,
    );
    x_ptr_offset += psEnc.subfr_length;

    if (warping_Q16 > 0) {
      // Warped autocorrelation (matches C: SKP_Silk_warped_autocorrelation_FIX)
      SKP_Silk_warped_autocorrelation_FIX(
        auto_corr,
        scale_obj,
        x_windowed,
        warping_Q16,
        psEnc.shapeWinLength,
        psEnc.shapingLPCOrder, // NOTE: C passes order (not order+1)
      );
    } else {
      // Regular autocorrelation (C: SKP_Silk_autocorr)
      autocorr(
        auto_corr,
        scale_obj,
        x_windowed,
        0,
        psEnc.shapeWinLength,
        psEnc.shapingLPCOrder + 1,
      );
    }

    auto_corr[0] += SKP_max(
      SMULWB(
        RSHIFT(auto_corr[0], 4),
        SKP_FIX_CONST(Tuning.SHAPE_WHITE_NOISE_FRACTION, 20),
      ),
      1,
    );

    nrg_obj.val = schur64(refl_coef_Q16, auto_corr, psEnc.shapingLPCOrder);
    AR2_Q24.fill(0);
    k2a_Q16(AR2_Q24, refl_coef_Q16, psEnc.shapingLPCOrder);

    Qnrg = -scale_obj.val;
    if (Qnrg & 1) {
      Qnrg -= 1;
      nrg_obj.val = RSHIFT(nrg_obj.val, 1);
    }
    tmp32 = SKP_Silk_SQRT_APPROX(Math.max(nrg_obj.val, 1));
    Qnrg = RSHIFT(Qnrg, 1);
    psEncCtrl.Gains_Q16[k] = SKP_LSHIFT_SAT32(tmp32, 16 - Qnrg);

    if (warping_Q16 > 0) {
      gain_mult_Q16 = warped_gain(AR2_Q24, warping_Q16, psEnc.shapingLPCOrder);
      psEncCtrl.Gains_Q16[k] = SMULWW(psEncCtrl.Gains_Q16[k], gain_mult_Q16);
      if (psEncCtrl.Gains_Q16[k] < 0) {
        psEncCtrl.Gains_Q16[k] = 0x7fffffff;
      }
    }

    SKP_Silk_bwexpander_32(AR2_Q24, psEnc.shapingLPCOrder, BWExp2_Q16);
    AR1_Q24.set(AR2_Q24);
    SKP_Silk_bwexpander_32(AR1_Q24, psEnc.shapingLPCOrder, BWExp1_Q16);

    // Correct: compute ratio of inverse prediction gains (energy domain)
    // Mirrors C: SKP_Silk_LPC_inverse_pred_gain_Q24(&pre_nrg_Q30, AR2_Q24, order)
    //            SKP_Silk_LPC_inverse_pred_gain_Q24(&nrg,         AR1_Q24, order)
    //            pre_nrg_Q30 = SKP_LSHIFT32(SKP_SMULWB(pre_nrg_Q30, 0.7_Q15), 1)
    //            GainsPre_Q14[k] = 0.3_Q14 + SKP_DIV32_varQ(pre_nrg_Q30, nrg, 14)
    const pre_nrg_Q30 = LPC_inverse_pred_gain_Q24(
      AR2_Q24,
      psEnc.shapingLPCOrder,
    );
    const nrg_Q30 = LPC_inverse_pred_gain_Q24(AR1_Q24, psEnc.shapingLPCOrder);
    const pre_nrg_Q30_scaled = LSHIFT(
      SMULWB(pre_nrg_Q30, SKP_FIX_CONST(0.7, 15)),
      1,
    );
    psEncCtrl.GainsPre_Q14[k] =
      SKP_FIX_CONST(0.3, 14) +
      SKP_DIV32_varQ(pre_nrg_Q30_scaled, Math.max(nrg_Q30, 1), 14);

    limit_warped_coefs(
      AR2_Q24,
      AR1_Q24,
      warping_Q16,
      SKP_FIX_CONST(3.999, 24),
      psEnc.shapingLPCOrder,
    );

    for (i = 0; i < psEnc.shapingLPCOrder; i++) {
      psEncCtrl.AR1_Q13[k * MAX_SHAPE_LPC_ORDER + i] = SKP_SAT16(
        RSHIFT_ROUND(AR1_Q24[i], 11),
      );
      psEncCtrl.AR2_Q13[k * MAX_SHAPE_LPC_ORDER + i] = SKP_SAT16(
        RSHIFT_ROUND(AR2_Q24[i], 11),
      );
    }
  }

  gain_mult_Q16 = SKP_Silk_log2lin(
    -SMLAWB(-SKP_FIX_CONST(16.0, 7), SNR_adj_dB_Q7, SKP_FIX_CONST(0.16, 16)),
  );
  gain_add_Q16 = SKP_Silk_log2lin(
    SMLAWB(
      SKP_FIX_CONST(16.0, 7),
      SKP_FIX_CONST(Tuning.NOISE_FLOOR_dB, 7),
      SKP_FIX_CONST(0.16, 16),
    ),
  );

  let avgGain_Q16 = psEnc.avgGain_Q16 | 0;
  tmp32 = SKP_Silk_log2lin(
    SMLAWB(
      SKP_FIX_CONST(16.0, 7),
      SKP_FIX_CONST(Tuning.RELATIVE_MIN_GAIN_dB, 7),
      SKP_FIX_CONST(0.16, 16),
    ),
  );
  gain_add_Q16 = ADD_SAT32(gain_add_Q16, SMULWW(avgGain_Q16, tmp32));

  for (k = 0; k < NB_SUBFR; k++) {
    psEncCtrl.Gains_Q16[k] = SMULWW(psEncCtrl.Gains_Q16[k], gain_mult_Q16);
    if (psEncCtrl.Gains_Q16[k] < 0) {
      psEncCtrl.Gains_Q16[k] = 0x7fffffff;
    }
    psEncCtrl.Gains_Q16[k] = ADD_POS_SAT32(
      psEncCtrl.Gains_Q16[k],
      gain_add_Q16,
    );

    avgGain_Q16 = ADD_SAT32(
      avgGain_Q16,
      SMULWB(
        psEncCtrl.Gains_Q16[k] - avgGain_Q16,
        RSHIFT_ROUND(
          SMULBB(
            psEnc.speech_activity_Q8,
            SKP_FIX_CONST(Tuning.GAIN_SMOOTHING_COEF, 10),
          ),
          2,
        ),
      ),
    );
  }
  psEnc.avgGain_Q16 = avgGain_Q16;

  // De-essing.
  gain_mult_Q16 =
    SKP_FIX_CONST(1.0, 16) +
    RSHIFT_ROUND(
      SKP_MLA(
        SKP_FIX_CONST(Tuning.INPUT_TILT, 26),
        psEncCtrl.coding_quality_Q14,
        SKP_FIX_CONST(Tuning.HIGH_RATE_INPUT_TILT, 12),
      ),
      10,
    );

  if (
    psEncCtrl.input_tilt_Q15 <= 0 &&
    psEncCtrl.sigtype === SIG_TYPE_UNVOICED
  ) {
    const sparseness_Q8 = ((psEncCtrl as any).sparseness_Q8 ?? 0) | 0;
    if (psEnc.fs_kHz === 24 || psEnc.fs_kHz === 16) {
      const deEss_dB =
        psEnc.fs_kHz === 24
          ? Tuning.DE_ESSER_COEF_SWB_dB
          : Tuning.DE_ESSER_COEF_WB_dB;
      const essStrength_Q15 = SMULWW(
        -psEncCtrl.input_tilt_Q15,
        SMULBB(psEnc.speech_activity_Q8, SKP_FIX_CONST(1.0, 8) - sparseness_Q8),
      );
      tmp32 = SKP_Silk_log2lin(
        SKP_FIX_CONST(16.0, 7) -
          SMULWB(
            essStrength_Q15,
            SMULWB(SKP_FIX_CONST(deEss_dB, 7), SKP_FIX_CONST(0.16, 17)),
          ),
      );
      gain_mult_Q16 = SMULWW(gain_mult_Q16, tmp32);
    }
  }

  for (k = 0; k < NB_SUBFR; k++) {
    psEncCtrl.GainsPre_Q14[k] = SMULWB(
      gain_mult_Q16,
      psEncCtrl.GainsPre_Q14[k],
    );
  }

  // LF shaping and tilt control.
  strength_Q16 = SKP_MUL(
    SKP_FIX_CONST(Tuning.LOW_FREQ_SHAPING, 0),
    SKP_FIX_CONST(1.0, 16) +
      SMULBB(
        SKP_FIX_CONST(Tuning.LOW_QUALITY_LOW_FREQ_SHAPING_DECR, 1),
        psEncCtrl.input_quality_bands_Q15[0] - SKP_FIX_CONST(1.0, 15),
      ),
  );

  if (psEncCtrl.sigtype === SIG_TYPE_VOICED) {
    const fs_kHz_inv = SKP_DIV32_16(SKP_FIX_CONST(0.2, 14), psEnc.fs_kHz);
    for (k = 0; k < NB_SUBFR; k++) {
      b_Q14 =
        fs_kHz_inv +
        SKP_DIV32_16(SKP_FIX_CONST(3.0, 14), Math.max(psEncCtrl.pitchL[k], 1));
      psEncCtrl.LF_shp_Q14[k] =
        LSHIFT(
          SKP_FIX_CONST(1.0, 14) - b_Q14 - SMULWB(strength_Q16, b_Q14),
          16,
        ) |
        ((b_Q14 - SKP_FIX_CONST(1.0, 14)) & 0xffff);
    }
    Tilt_Q16 =
      -SKP_FIX_CONST(Tuning.HP_NOISE_COEF, 16) -
      SMULWB(
        SKP_FIX_CONST(1.0, 16) - SKP_FIX_CONST(Tuning.HP_NOISE_COEF, 16),
        SMULWB(
          SKP_FIX_CONST(Tuning.HARM_HP_NOISE_COEF, 24),
          psEnc.speech_activity_Q8,
        ),
      );
  } else {
    b_Q14 = SKP_DIV32_16(21299, psEnc.fs_kHz);
    psEncCtrl.LF_shp_Q14[0] =
      LSHIFT(
        SKP_FIX_CONST(1.0, 14) -
          b_Q14 -
          SMULWB(strength_Q16, SMULWB(SKP_FIX_CONST(0.6, 16), b_Q14)),
        16,
      ) |
      ((b_Q14 - SKP_FIX_CONST(1.0, 14)) & 0xffff);
    for (k = 1; k < NB_SUBFR; k++) {
      psEncCtrl.LF_shp_Q14[k] = psEncCtrl.LF_shp_Q14[0];
    }
    Tilt_Q16 = -SKP_FIX_CONST(Tuning.HP_NOISE_COEF, 16);
  }

  // Harmonic shaping control.
  HarmBoost_Q16 = SMULWB(
    SMULWB(
      SKP_FIX_CONST(1.0, 17) - LSHIFT(psEncCtrl.coding_quality_Q14, 3),
      psEnc.LTPCorr_Q15,
    ),
    SKP_FIX_CONST(Tuning.LOW_RATE_HARMONIC_BOOST, 16),
  );
  HarmBoost_Q16 = SMLAWB(
    HarmBoost_Q16,
    SKP_FIX_CONST(1.0, 16) - LSHIFT(psEncCtrl.input_quality_Q14, 2),
    SKP_FIX_CONST(Tuning.LOW_INPUT_QUALITY_HARMONIC_BOOST, 16),
  );

  const USE_HARM_SHAPING = 1;
  if (USE_HARM_SHAPING && psEncCtrl.sigtype === SIG_TYPE_VOICED) {
    HarmShapeGain_Q16 = SMLAWB(
      SKP_FIX_CONST(Tuning.HARMONIC_SHAPING, 16),
      SKP_FIX_CONST(1.0, 16) -
        SMULWB(
          SKP_FIX_CONST(1.0, 18) - LSHIFT(psEncCtrl.coding_quality_Q14, 4),
          psEncCtrl.input_quality_Q14,
        ),
      SKP_FIX_CONST(Tuning.HIGH_RATE_OR_LOW_QUALITY_HARMONIC_SHAPING, 16),
    );
    HarmShapeGain_Q16 = SMULWB(
      LSHIFT(HarmShapeGain_Q16, 1),
      SKP_Silk_SQRT_APPROX(LSHIFT(psEnc.LTPCorr_Q15, 15)),
    );
  } else {
    HarmShapeGain_Q16 = 0;
  }

  // Smooth subframe-wise controls.
  psShapeSt.HarmBoost_smth_Q16 = psShapeSt.HarmBoost_smth_Q16 ?? 0;
  psShapeSt.HarmShapeGain_smth_Q16 = psShapeSt.HarmShapeGain_smth_Q16 ?? 0;
  psShapeSt.Tilt_smth_Q16 = psShapeSt.Tilt_smth_Q16 ?? 0;

  for (k = 0; k < NB_SUBFR; k++) {
    psShapeSt.HarmBoost_smth_Q16 = SMLAWB(
      psShapeSt.HarmBoost_smth_Q16,
      HarmBoost_Q16 - psShapeSt.HarmBoost_smth_Q16,
      SKP_FIX_CONST(Tuning.SUBFR_SMTH_COEF, 16),
    );
    psShapeSt.HarmShapeGain_smth_Q16 = SMLAWB(
      psShapeSt.HarmShapeGain_smth_Q16,
      HarmShapeGain_Q16 - psShapeSt.HarmShapeGain_smth_Q16,
      SKP_FIX_CONST(Tuning.SUBFR_SMTH_COEF, 16),
    );
    psShapeSt.Tilt_smth_Q16 = SMLAWB(
      psShapeSt.Tilt_smth_Q16,
      Tilt_Q16 - psShapeSt.Tilt_smth_Q16,
      SKP_FIX_CONST(Tuning.SUBFR_SMTH_COEF, 16),
    );

    psEncCtrl.HarmBoost_Q14[k] = RSHIFT_ROUND(psShapeSt.HarmBoost_smth_Q16, 2);
    psEncCtrl.HarmShapeGain_Q14[k] = RSHIFT_ROUND(
      psShapeSt.HarmShapeGain_smth_Q16,
      2,
    );
    psEncCtrl.Tilt_Q14[k] = RSHIFT_ROUND(psShapeSt.Tilt_smth_Q16, 2);
  }
}
