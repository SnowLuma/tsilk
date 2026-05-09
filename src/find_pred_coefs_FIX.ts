// ── C-comparison trace controls ────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

import { EncoderState, EncoderControl } from "./structs";
import * as D from "./defines";
import {
  SKP_Silk_SQRT_APPROX as SQRT_APPROX,
  SKP_max_int,
  SKP_min_int,
  SKP_DIV32_varQ,
  SKP_SMULWB,
  SKP_SMULBB,
  SKP_RSHIFT,
  SKP_DIV32,
  SKP_FIX_CONST,
  SKP_SMLAWB,
} from "./macros";
import { type NLSFCB } from "./nlsf";
import { NLSF2A_stable } from "./nlsf2a_stable";
import { SKP_Silk_LTP_analysis_filter_FIX } from "./LTP_analysis_filter_FIX";
import { SKP_Silk_find_LPC_FIX } from "./find_LPC_FIX";
import { SKP_Silk_quant_LTP_gains_FIX } from "./quant_LTP_gains_FIX";
import { SKP_Silk_LTP_scale_ctrl_FIX } from "./LTP_scale_ctrl_FIX";
import {
  SKP_Silk_NLSF_VQ_weights_laroia,
  SKP_Silk_NLSF_MSVQ_encode_FIX,
  SKP_Silk_interpolate,
} from "./nlsf_vq";
import { SKP_Silk_residual_energy_FIX } from "./residual_energy_FIX";
import { SKP_Silk_find_LTP_FIX } from "./find_LTP_FIX";

function ensurePrevNLSF(psEnc: EncoderState, lpcOrder: number): Int32Array {
  if (
    !psEnc.sPred.prev_NLSFq_Q15 ||
    psEnc.sPred.prev_NLSFq_Q15.length !== lpcOrder
  ) {
    psEnc.sPred.prev_NLSFq_Q15 = new Int32Array(lpcOrder);
  }
  return psEnc.sPred.prev_NLSFq_Q15 as Int32Array;
}

function estimateLTPFromResidual(
  psEnc: EncoderState,
  psEncCtrl: EncoderControl,
  res_pitch: Int16Array,
  Wght_Q15: Int32Array,
  outB_Q14: Int16Array,
  outWLTP: Int32Array,
): void {
  const subfrLen = psEnc.subfr_length;
  const frameLen = psEnc.frame_length;
  const center = (D.LTP_ORDER >> 1) | 0;

  outB_Q14.fill(0);
  outWLTP.fill(0);

  for (let k = 0; k < D.NB_SUBFR; k++) {
    const lag = Math.max(2, psEncCtrl.pitchL[k] | 0);
    const start = k * subfrLen;

    for (let j = 0; j < D.LTP_ORDER; j++) {
      const delay = lag + center - j;
      let corr = 0;
      let ener = 1;
      for (let i = 0; i < subfrLen; i++) {
        const xIdx = start + i;
        const yIdx = xIdx - delay;
        if (xIdx >= 0 && xIdx < frameLen && yIdx >= 0 && yIdx < frameLen) {
          const x = res_pitch[xIdx] | 0;
          const y = res_pitch[yIdx] | 0;
          corr += x * y;
          ener += y * y;
        }
      }
      const cQ14 = SKP_DIV32_varQ(corr, ener, 14);
      outB_Q14[k * D.LTP_ORDER + j] = SKP_min_int(
        32767,
        SKP_max_int(-32768, cQ14),
      );
    }

    const wDiag = Math.max(1, Wght_Q15[k] | 0) << 3;
    const base = k * D.LTP_ORDER * D.LTP_ORDER;
    for (let r = 0; r < D.LTP_ORDER; r++) {
      outWLTP[base + r * D.LTP_ORDER + r] = wDiag;
    }
  }
}

export function find_pred_coefs_FIX(
  psEnc: EncoderState,
  psEncCtrl: EncoderControl,
  res_pitch: Int16Array,
): void {
  const lpcOrder = (psEnc.sCmn?.predictLPCOrder as number) || D.MAX_LPC_ORDER;
  const subfrLen = psEnc.subfr_length;
  const frameLen = psEnc.frame_length;

  const invGains_Q16 = new Int32Array(D.NB_SUBFR);
  const local_gains = new Int32Array(D.NB_SUBFR);
  const Wght_Q15 = new Int32Array(D.NB_SUBFR);

  psEncCtrl.PredCoef_Q12.fill(0);
  psEncCtrl.LTPCoef_Q14.fill(0);
  psEncCtrl.LTP_scale_Q14 = 0;
  psEncCtrl.LTPIndex.fill(0);
  psEncCtrl.NLSFIndices.fill(0);

  let min_gain_Q16 = 0x7fffffff >> 6;
  for (let k = 0; k < D.NB_SUBFR; k++) {
    min_gain_Q16 = Math.min(
      min_gain_Q16,
      Math.max(1, psEncCtrl.Gains_Q16[k] | 0),
    );
  }

  for (let k = 0; k < D.NB_SUBFR; k++) {
    const g = Math.max(1, psEncCtrl.Gains_Q16[k] | 0);
    let invQ16 = SKP_DIV32_varQ(min_gain_Q16, g, 14);
    invQ16 = Math.max(invQ16, 363);
    invGains_Q16[k] = invQ16;
    Wght_Q15[k] = SKP_RSHIFT(SKP_SMULWB(invQ16, invQ16), 1);
    local_gains[k] = SKP_DIV32(1 << 16, invQ16);
  }

  const LPC_in_pre = new Int16Array(D.NB_SUBFR * (subfrLen + lpcOrder));

  if (psEncCtrl.sCmn?.sigtype === 0 || psEncCtrl.sigtype === 0 /*VOICED*/) {
    const WLTP = new Int32Array(D.NB_SUBFR * D.LTP_ORDER * D.LTP_ORDER);
    const b_Q14 = new Int16Array(D.NB_SUBFR * D.LTP_ORDER);
    const corr_rshifts = new Int32Array(D.NB_SUBFR);
    const ltpGainQ7 = { val: 0 };

    // r_last is res_pitch starting from frame_length/2
    // Mirrors C: r_last = r_first + SKP_RSHIFT(frame_length, 1)
    const r_last_offset = SKP_RSHIFT(frameLen, 1);

    SKP_Silk_find_LTP_FIX(
      b_Q14,
      WLTP,
      ltpGainQ7,
      res_pitch, // r_first
      res_pitch.subarray(r_last_offset), // r_last
      psEncCtrl.pitchL,
      Wght_Q15,
      subfrLen,
      frameLen, // mem_offset = frame_length (not frame_length - lpcOrder)
      corr_rshifts,
    );
    psEncCtrl.LTPredCodGain_Q7 = ltpGainQ7.val;

    const perIndex = { val: 0 };
    SKP_Silk_quant_LTP_gains_FIX(
      b_Q14,
      psEncCtrl.LTPIndex,
      perIndex,
      WLTP,
      psEnc.mu_LTP_Q8 ?? 20,
      (psEnc.sCmn?.LTPQuantLowComplexity ?? 0) | 0,
    );
    psEncCtrl.PERIndex = perIndex.val;
    psEncCtrl.LTPCoef_Q14.set(b_Q14);

    SKP_Silk_LTP_scale_ctrl_FIX(psEnc, psEncCtrl);

    // Correct x_buf offset: frame_length - predictLPCOrder
    // Mirrors C: psEnc->x_buf + psEnc->sCmn.frame_length - psEnc->sCmn.predictLPCOrder
    const x_ltp_offset = frameLen - lpcOrder;
    SKP_Silk_LTP_analysis_filter_FIX(
      LPC_in_pre,
      psEnc.x_buf,
      x_ltp_offset,
      psEncCtrl.LTPCoef_Q14,
      psEncCtrl.pitchL,
      invGains_Q16,
      subfrLen,
      lpcOrder,
    );
  } else {
    psEncCtrl.LTPCoef_Q14.fill(0);
    psEncCtrl.LTPredCodGain_Q7 = 0;
    for (let k = 0; k < D.NB_SUBFR; k++) {
      const inOff = Math.max(0, frameLen - lpcOrder + k * subfrLen);
      const outOff = k * (subfrLen + lpcOrder);
      for (let i = 0; i < subfrLen + lpcOrder; i++) {
        const s = psEnc.x_buf[inOff + i] | 0;
        LPC_in_pre[outOff + i] = SKP_RSHIFT(SKP_SMULWB(invGains_Q16[k], s), 0);
      }
    }
  }

  const prevNLSF = ensurePrevNLSF(psEnc, lpcOrder);
  const pNLSF_Q15 = new Int32Array(lpcOrder);
  const interpIndex = { val: 4 };

  SKP_Silk_find_LPC_FIX(
    pNLSF_Q15,
    interpIndex,
    prevNLSF,
    ((psEnc.sCmn?.useInterpolatedNLSFs ?? 1) *
      (1 - (psEnc.first_frame_after_reset | 0))) |
    0,
    lpcOrder,
    LPC_in_pre,
    0,
    subfrLen + lpcOrder,
  );
  psEncCtrl.NLSFInterpCoef_Q2 = interpIndex.val;

  const pNLSFW_Q6 = new Int32Array(lpcOrder);
  SKP_Silk_NLSF_VQ_weights_laroia(pNLSFW_Q6, pNLSF_Q15, lpcOrder);
  const doInterpolate =
    ((psEnc.sCmn?.useInterpolatedNLSFs ?? 1) === 1) && interpIndex.val < (1 << 2);
  if (doInterpolate) {
    const pNLSF0_temp_Q15 = new Int32Array(lpcOrder);
    const pNLSFW0_temp_Q6 = new Int32Array(lpcOrder);
    SKP_Silk_interpolate(
      pNLSF0_temp_Q15,
      prevNLSF,
      pNLSF_Q15,
      interpIndex.val,
      lpcOrder,
    );
    SKP_Silk_NLSF_VQ_weights_laroia(
      pNLSFW0_temp_Q6,
      pNLSF0_temp_Q15,
      lpcOrder,
    );
    const i_sqr_Q15 =
      SKP_SMULBB(interpIndex.val, interpIndex.val) << 11;
    for (let i = 0; i < lpcOrder; i++) {
      pNLSFW_Q6[i] = SKP_SMLAWB(
        pNLSFW_Q6[i] >> 1,
        pNLSFW0_temp_Q6[i],
        i_sqr_Q15,
      );
    }
  }

  const nlsfIndicesArr = new Array<number>(
    (psEnc.sCmn?.psNLSF_CB?.[psEncCtrl.sigtype] as NLSFCB).nStages,
  ).fill(0);
  const nlsf_mu_Q15 =
    psEncCtrl.sigtype === D.SIG_TYPE_VOICED
      ? SKP_SMLAWB(66, -8388, psEnc.speech_activity_Q8)
      : SKP_SMLAWB(164, -33554, psEnc.speech_activity_Q8);
  const nlsf_mu_fluc_Q16 =
    psEncCtrl.sigtype === D.SIG_TYPE_VOICED
      ? SKP_SMLAWB(6554, -838848, psEnc.speech_activity_Q8)
      : SKP_SMLAWB(
        13107,
        -1677696,
        psEnc.speech_activity_Q8 + (psEncCtrl.sparseness_Q8 ?? 0),
      );

  SKP_Silk_NLSF_MSVQ_encode_FIX(
    nlsfIndicesArr,
    pNLSF_Q15,
    psEnc.sCmn.psNLSF_CB[psEncCtrl.sigtype] as NLSFCB,
    prevNLSF,
    pNLSFW_Q6,
    Math.max(1, nlsf_mu_Q15),
    nlsf_mu_fluc_Q16,
    (psEnc.sCmn?.NLSF_MSVQ_Survivors ?? 8) | 0,
    lpcOrder,
    psEnc.first_frame_after_reset | 0,
  );
  for (let i = 0; i < nlsfIndicesArr.length; i++) {
    psEncCtrl.NLSFIndices[i] = nlsfIndicesArr[i] | 0;
  }

  const pred0 = psEncCtrl.PredCoef_Q12.subarray(0, lpcOrder);
  const pred1 = psEncCtrl.PredCoef_Q12.subarray(
    D.MAX_LPC_ORDER,
    D.MAX_LPC_ORDER + lpcOrder,
  );
  NLSF2A_stable(pred1, pNLSF_Q15, lpcOrder);

  if (interpIndex.val < 4) {
    const pNLSF0 = new Int32Array(lpcOrder);
    SKP_Silk_interpolate(
      pNLSF0,
      prevNLSF,
      pNLSF_Q15,
      interpIndex.val,
      lpcOrder,
    );
    NLSF2A_stable(pred0, pNLSF0, lpcOrder);
  } else {
    pred0.set(pred1);
  }

  const predPair = [pred0, pred1] as unknown as Int16Array[];
  SKP_Silk_residual_energy_FIX(
    psEncCtrl.ResNrg,
    psEncCtrl.ResNrgQ,
    LPC_in_pre,
    0,
    predPair,
    local_gains,
    subfrLen,
    lpcOrder,
  );

  prevNLSF.set(pNLSF_Q15);

  for (let k = 0; k < D.NB_SUBFR; k++) {
    if (psEncCtrl.Gains_Q16[k] <= 0) {
      const e = Math.max(1, psEncCtrl.ResNrg[k] | 0);
      const rms = SQRT_APPROX(Math.max((e / Math.max(subfrLen, 1)) | 0, 1));
      psEncCtrl.Gains_Q16[k] = Math.max(rms << 8, 1 << 16);
    }
  }
}

