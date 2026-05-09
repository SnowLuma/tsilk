import { EncoderState } from "./structs";
import { encodeFrame } from "./encode_frame";
import { RangeCoderState } from "./range_coder";
import { VAD_Init } from "./vad";
import * as D from "./defines";
import * as T from "./tables";
import { buildNLSFCB } from "./nlsf_codebooks";
import * as TP from "./tuning_parameters";

const SUPPORTED_API_SAMPLE_RATES = [8000, 12000, 16000, 24000] as const;
const SUPPORTED_PACKET_SIZES_MS = [20, 40, 60, 80, 100] as const;

function normalizeApiSampleRate(sampleRate: number): number {
  const normalized = sampleRate | 0;
  if (
    !SUPPORTED_API_SAMPLE_RATES.includes(
      normalized as (typeof SUPPORTED_API_SAMPLE_RATES)[number],
    )
  ) {
    throw new Error(
      `Unsupported SILK sample rate: ${sampleRate}. Expected one of ${SUPPORTED_API_SAMPLE_RATES.join(", ")} Hz.`,
    );
  }
  return normalized;
}

function normalizePacketSize(packetSizeMs: number): number {
  const normalized = packetSizeMs | 0;
  if (
    !SUPPORTED_PACKET_SIZES_MS.includes(
      normalized as (typeof SUPPORTED_PACKET_SIZES_MS)[number],
    )
  ) {
    throw new Error(
      `Unsupported SILK packet size: ${packetSizeMs}. Expected one of ${SUPPORTED_PACKET_SIZES_MS.join(", ")} ms.`,
    );
  }
  return normalized;
}

function toQ8(value: number): number {
  return Math.round(value * 256) | 0;
}

function computeTargetSNR_Q7(fs_kHz: number, targetRateBps: number): number {
  const rateTables: Record<number, Int32Array> = {
    8: T.TargetRate_table_NB,
    12: T.TargetRate_table_MB,
    16: T.TargetRate_table_WB,
    24: T.TargetRate_table_SWB,
  };
  const rateTable = rateTables[fs_kHz] ?? T.TargetRate_table_WB;
  const clampedRate = Math.max(
    D.MIN_TARGET_RATE_BPS,
    Math.min(D.MAX_TARGET_RATE_BPS, targetRateBps | 0),
  );

  for (let k = 1; k < rateTable.length; k++) {
    if (clampedRate <= rateTable[k]) {
      const rateLo = rateTable[k - 1] | 0;
      const rateHi = rateTable[k] | 0;
      if (rateHi === rateLo) {
        return (T.SNR_table_Q1[k - 1] | 0) << 6;
      }
      // Mirror C exactly:
      // frac_Q6 = DIV32( (TargetRate - rateLo) << 6, rateHi - rateLo )
      // SNR_dB_Q7 = (SNR_Q1[k-1] << 6) + frac_Q6 * (SNR_Q1[k] - SNR_Q1[k-1])
      const frac_Q6 = (((clampedRate - rateLo) << 6) / (rateHi - rateLo)) | 0;
      return (((T.SNR_table_Q1[k - 1] | 0) << 6) + frac_Q6 * ((T.SNR_table_Q1[k] | 0) - (T.SNR_table_Q1[k - 1] | 0))) | 0;
    }
  }

  return (T.SNR_table_Q1[T.SNR_table_Q1.length - 1] | 0) << 6;
}

function selectInitialInternalFsKHz(
  apiSampleRate: number,
  maxInternalSampleRate: number,
  targetRateBps: number,
): number {
  // C thresholds from SKP_Silk_define.h
  const SWB2WB_BITRATE_BPS = 25000;
  const WB2MB_BITRATE_BPS = 14000;
  const MB2NB_BITRATE_BPS = 10000;

  let fs_kHz = 8;
  if (targetRateBps >= SWB2WB_BITRATE_BPS) {
    fs_kHz = 24;
  } else if (targetRateBps >= WB2MB_BITRATE_BPS) {
    fs_kHz = 16;
  } else if (targetRateBps >= MB2NB_BITRATE_BPS) {
    fs_kHz = 12;
  }

  fs_kHz = Math.min(fs_kHz, (apiSampleRate / 1000) | 0);
  fs_kHz = Math.min(fs_kHz, (maxInternalSampleRate / 1000) | 0);
  return fs_kHz | 0;
}

export interface EncoderOptions {
  API_sampleRate: number;
  maxInternalSampleRate?: number;
  packetSize?: number;
  bitRate?: number;
  packetLossPercentage?: number;
  complexity?: number;
  useInBandFEC?: boolean;
  useDTX?: boolean;
}

export class SilkEncoder {
  public state: EncoderState;

  constructor() {
    this.state = new EncoderState();
    this.init();
  }

  public init(): void {
    this.state = new EncoderState();
    this.state.fs_kHz = 16;
    this.state.frame_length = D.FRAME_LENGTH_MS * this.state.fs_kHz;
    this.state.subfr_length = this.state.frame_length / D.NB_SUBFR;
    this.state.la_pitch = D.LA_PITCH_MS * this.state.fs_kHz;
    this.state.la_shape = D.LA_SHAPE_MS * this.state.fs_kHz;
    this.state.shapeWinLength = 5 * this.state.fs_kHz + 2 * this.state.la_shape;
    this.state.TargetRate_bps = 25000;
    this.state.PacketSize_ms = D.FRAME_LENGTH_MS;
    this.state.nStatesDelayedDecision = 1;
    this.state.pitchEstimationLPCOrder = D.MAX_FIND_PITCH_LPC_ORDER;

    this.state.sRC = new RangeCoderState();
    this.state.sRC_LBRR = new RangeCoderState();
    this.state.LBRR_buffer = Array.from({ length: D.MAX_LBRR_DELAY }, () => ({
      payload: new Uint8Array(D.MAX_ARITHM_BYTES),
      nBytes: 0,
      usage: D.SKP_SILK_NO_LBRR,
    }));

    this.state.sVAD = {
      AnaState: new Int32Array(2),
      AnaState1: new Int32Array(2),
      AnaState2: new Int32Array(2),
      XnrgSubfr: new Int32Array(D.VAD_N_BANDS),
      NrgRatioSmth_Q8: new Int32Array(D.VAD_N_BANDS),
      HPstate: 0,
      NL: new Int32Array(D.VAD_N_BANDS),
      inv_NL: new Int32Array(D.VAD_N_BANDS),
      NoiseLevelBias: new Int32Array(D.VAD_N_BANDS),
      counter: 0,
    };
    VAD_Init(this.state.sVAD);

    this.state.sPrefilt = {
      sLTP_shp: new Int16Array(D.LTP_BUF_LENGTH),
      sLTP_shp_buf_idx: 0,
      sLF_AR_shp_Q12: 0,
      sLF_MA_shp_Q12: 0,
      sAR_shp: new Int32Array(D.MAX_SHAPE_LPC_ORDER + 1),
      sHarmHP: 0,
      lagPrev: 100,
    };
    this.state.avgGain_Q16 = 0;
    this.state.avgGain_Q16_one_bit_per_sample = 0;
    this.state.sShape = {
      LastGainIndex: 1,
      HarmBoost_smth_Q16: 0,
      HarmShapeGain_smth_Q16: 0,
      Tilt_smth_Q16: 0,
    };
    this.state.sPred = {
      pitch_LPC_win_length: D.FIND_PITCH_LPC_WIN_MS * this.state.fs_kHz,
    };

    // Match C init: disable NLSF interpolation/fluctuation reduction only for first frame.
    this.state.first_frame_after_reset = 1;
    this.state.sCmn.first_frame_after_reset = 1;
    this.state.prevLag = 100;
    this.state.sCmn.prevLag = 100;
    this.state.prev_sigtype = D.SIG_TYPE_UNVOICED;
    this.state.sCmn.prev_sigtype = D.SIG_TYPE_UNVOICED;
    // Match C init: default variable input HP cutoff smoothing state.
    this.state.variable_HP_smth1_Q15 = 200844;
    this.state.variable_HP_smth2_Q15 = 200844;
    // Match C init: NSQ inverse gain state.
    this.state.sNSQ.prev_inv_gain_Q16 = 65536;
    this.state.sNSQ_LBRR.prev_inv_gain_Q16 = 65536;
    this.state.sNSQ.lagPrev = 100;
    this.state.sNSQ_LBRR.lagPrev = 100;

    // Select LPC order/codebooks first, then clamp complexity-dependent LPC order against it.
    this.configureNLSFCodebooks();
    this.setupComplexity(2);
  }

  private setupComplexity(complexity: number): void {
    const c = Math.max(0, Math.min(2, complexity | 0));

    this.state.Complexity = c;
    this.state.sCmn.Complexity = c;

    if (c === 0) {
      this.state.pitchEstimationComplexity = 0;
      this.state.pitchEstimationThreshold_Q16 =
        D.FIND_PITCH_CORRELATION_THRESHOLD_LC_MODE;
      this.state.pitchEstimationLPCOrder = 6;
      this.state.shapingLPCOrder = 8;
      this.state.la_shape = 3 * this.state.fs_kHz;
      this.state.sCmn.useInterpolatedNLSFs = 0;
      this.state.sCmn.LTPQuantLowComplexity = 1;
      this.state.sCmn.NLSF_MSVQ_Survivors = 2;
    } else if (c === 1) {
      this.state.pitchEstimationComplexity = 1;
      this.state.pitchEstimationThreshold_Q16 =
        D.FIND_PITCH_CORRELATION_THRESHOLD_MC_MODE;
      this.state.pitchEstimationLPCOrder = 12;
      this.state.shapingLPCOrder = 12;
      this.state.la_shape = 5 * this.state.fs_kHz;
      this.state.sCmn.useInterpolatedNLSFs = 0;
      this.state.sCmn.LTPQuantLowComplexity = 0;
      this.state.sCmn.NLSF_MSVQ_Survivors = 4;
    } else {
      this.state.pitchEstimationComplexity = 2;
      this.state.pitchEstimationThreshold_Q16 =
        D.FIND_PITCH_CORRELATION_THRESHOLD_HC_MODE;
      this.state.pitchEstimationLPCOrder = 16;
      this.state.shapingLPCOrder = 16;
      this.state.la_shape = 5 * this.state.fs_kHz;
      this.state.sCmn.useInterpolatedNLSFs = 1;
      this.state.sCmn.LTPQuantLowComplexity = 0;
      this.state.sCmn.NLSF_MSVQ_Survivors = 16;
    }

    if (c === 0) {
      this.state.nStatesDelayedDecision = 1;
    } else if (c === 1) {
      this.state.nStatesDelayedDecision = 2;
    } else {
      this.state.nStatesDelayedDecision = 4;
    }
    // warping_Q16: match C setup_complexity (0.015 * 65536 = 983 per fs_kHz unit)
    const WARPING_MULT_Q16 = 983; // SKP_FIX_CONST(0.015, 16)
    if (c >= 1) {
      this.state.warping_Q16 = this.state.fs_kHz * WARPING_MULT_Q16;
    } else {
      this.state.warping_Q16 = 0;
    }

    this.state.pitchEstimationLPCOrder = Math.min(
      this.state.pitchEstimationLPCOrder,
      this.state.sCmn.predictLPCOrder | 0 || D.MAX_LPC_ORDER,
    );
    this.state.shapeWinLength = 5 * this.state.fs_kHz + 2 * this.state.la_shape;

    this.state.sCmn.nStatesDelayedDecision = this.state.nStatesDelayedDecision;
    this.state.sCmn.warping_Q16 = this.state.warping_Q16;
    this.state.sCmn.first_frame_after_reset =
      this.state.first_frame_after_reset | 0;
  }

  private configureNLSFCodebooks(): void {
    const useLpc10 = this.state.fs_kHz <= 8;
    const lpcOrder = useLpc10 ? 10 : 16;
    this.state.sCmn.predictLPCOrder = lpcOrder;
    this.state.sCmn.psNLSF_CB = new Array(2);

    if (useLpc10) {
      this.state.sCmn.psNLSF_CB[0] = buildNLSFCB(
        T.nlsf_cb0_10_nStages,
        T.nlsf_cb0_10_stageVectors,
        T.nlsf_cb0_10_CDF,
        T.nlsf_cb0_10_CDF_start_offsets,
        T.nlsf_cb0_10_CDF_middle_idx,
        T.nlsf_cb0_10_ndelta_min_Q15,
        T.nlsf_cb0_10_Q15,
        T.SKP_Silk_NLSF_MSVQ_CB0_10_rates_Q5,
        10,
      );
      this.state.sCmn.psNLSF_CB[1] = buildNLSFCB(
        T.nlsf_cb1_10_nStages,
        T.nlsf_cb1_10_stageVectors,
        T.nlsf_cb1_10_CDF,
        T.nlsf_cb1_10_CDF_start_offsets,
        T.nlsf_cb1_10_CDF_middle_idx,
        T.nlsf_cb1_10_ndelta_min_Q15,
        T.nlsf_cb1_10_Q15,
        T.SKP_Silk_NLSF_MSVQ_CB1_10_rates_Q5,
        10,
      );
    } else {
      this.state.sCmn.psNLSF_CB[0] = buildNLSFCB(
        T.nlsf_cb0_16_nStages,
        T.nlsf_cb0_16_stageVectors,
        T.nlsf_cb0_16_CDF,
        T.nlsf_cb0_16_CDF_start_offsets,
        T.nlsf_cb0_16_CDF_middle_idx,
        T.nlsf_cb0_16_ndelta_min_Q15,
        T.build_nlsf_cb0_16_Q15(),
        T.SKP_Silk_NLSF_MSVQ_CB0_16_rates_Q5,
        16,
      );
      this.state.sCmn.psNLSF_CB[1] = buildNLSFCB(
        T.nlsf_cb1_16_nStages,
        T.nlsf_cb1_16_stageVectors,
        T.nlsf_cb1_16_CDF,
        T.nlsf_cb1_16_CDF_start_offsets,
        T.nlsf_cb1_16_CDF_middle_idx,
        T.nlsf_cb1_16_ndelta_min_Q15,
        T.build_nlsf_cb1_16_Q15(),
        T.SKP_Silk_NLSF_MSVQ_CB1_16_rates_Q5,
        16,
      );
    }
  }

  private applyOptions(options: EncoderOptions): void {
    const sampleRate = normalizeApiSampleRate(options.API_sampleRate || 16000);
    const packetSizeMs = normalizePacketSize(
      options.packetSize ?? D.FRAME_LENGTH_MS,
    );
    const maxInternalSampleRate = normalizeApiSampleRate(
      options.maxInternalSampleRate ?? sampleRate,
    );
    const targetRate = options.bitRate ?? this.state.TargetRate_bps;
    const fs_kHz = selectInitialInternalFsKHz(
      sampleRate,
      maxInternalSampleRate,
      targetRate,
    );
    const prevFs_kHz = this.state.fs_kHz | 0;
    const fsChanged = prevFs_kHz !== (fs_kHz | 0);

    if (fsChanged) {
      // Mirror C setup_fs reset path for state that impacts early-frame behavior.
      this.state.nFramesInPayloadBuf = 0;
      this.state.nBytesInPayloadBuf = 0;
      this.state.oldest_LBRR_idx = 0;
      this.state.prevLag = 100;
      this.state.prev_sigtype = D.SIG_TYPE_UNVOICED;
      this.state.first_frame_after_reset = 1;

      this.state.sPrefilt.lagPrev = 100;
      this.state.sShape.LastGainIndex = 1;
      this.state.sNSQ.lagPrev = 100;
      this.state.sNSQ.prev_inv_gain_Q16 = 65536;
      this.state.sNSQ_LBRR.prev_inv_gain_Q16 = 65536;
      this.state.LBRR_buffer = Array.from({ length: D.MAX_LBRR_DELAY }, () => ({
        payload: new Uint8Array(D.MAX_ARITHM_BYTES),
        nBytes: 0,
        usage: D.SKP_SILK_NO_LBRR,
      }));

      this.state.sCmn.first_frame_after_reset = 1;
      this.state.sCmn.prev_sigtype = D.SIG_TYPE_UNVOICED;
    }

    this.state.fs_kHz = fs_kHz;
    this.state.frame_length = D.FRAME_LENGTH_MS * fs_kHz;
    this.state.subfr_length = this.state.frame_length / D.NB_SUBFR;
    this.state.la_pitch = D.LA_PITCH_MS * fs_kHz;
    this.state.la_shape = D.LA_SHAPE_MS * fs_kHz;
    this.state.shapeWinLength = 5 * this.state.fs_kHz + 2 * this.state.la_shape;
    this.state.TargetRate_bps = targetRate;
    this.state.PacketSize_ms = packetSizeMs;
    this.state.sPred.pitch_LPC_win_length = D.FIND_PITCH_LPC_WIN_MS * fs_kHz;
    this.state.sPred.min_pitch_lag = 3 * fs_kHz;
    this.state.sPred.max_pitch_lag = 18 * fs_kHz;
    this.state.sCmn.PacketLoss_perc = options.packetLossPercentage ?? 0;
    this.state.useInBandFEC = options.useInBandFEC ? 1 : 0;
    this.state.sCmn.useDTX = options.useDTX ? 1 : 0;
    this.state.sCmn.useInBandFEC = this.state.useInBandFEC;
    this.state.SNR_dB_Q7 = computeTargetSNR_Q7(fs_kHz, targetRate);

    // Mirror C setup_LBRR behavior.
    if (this.state.useInBandFEC) {
      let lbrrRateThres = D.INBAND_FEC_MIN_RATE_BPS;
      if (fs_kHz === 8) {
        lbrrRateThres -= 9000;
      } else if (fs_kHz === 12) {
        lbrrRateThres -= 6000;
      } else if (fs_kHz === 16) {
        lbrrRateThres -= 3000;
      }
      const pl = this.state.sCmn.PacketLoss_perc | 0;
      this.state.LBRR_enabled = 1;
      this.state.sCmn.LBRR_enabled = 1;
      if ((this.state.TargetRate_bps | 0) >= lbrrRateThres) {
        this.state.LBRR_GainIncreases = Math.max(8 - (pl >> 1), 0) | 0;
        this.state.sCmn.LBRR_GainIncreases = this.state.LBRR_GainIncreases;
        if (this.state.LBRR_enabled && pl > D.LBRR_LOSS_THRES) {
          this.state.inBandFEC_SNR_comp_Q8 =
            ((6 << 8) - (this.state.LBRR_GainIncreases << 7)) | 0;
        } else {
          this.state.inBandFEC_SNR_comp_Q8 = 0;
          this.state.LBRR_enabled = 0;
          this.state.sCmn.LBRR_enabled = 0;
        }
      } else {
        this.state.inBandFEC_SNR_comp_Q8 = 0;
        this.state.LBRR_enabled = 0;
        this.state.sCmn.LBRR_enabled = 0;
      }
    } else {
      this.state.LBRR_enabled = 0;
      this.state.sCmn.LBRR_enabled = 0;
      this.state.LBRR_GainIncreases = 0;
      this.state.sCmn.LBRR_GainIncreases = 0;
      this.state.inBandFEC_SNR_comp_Q8 = 0;
    }

    if (fs_kHz === 24) {
      this.state.mu_LTP_Q8 = toQ8(TP.MU_LTP_QUANT_SWB);
    } else if (fs_kHz === 16) {
      this.state.mu_LTP_Q8 = toQ8(TP.MU_LTP_QUANT_WB);
    } else if (fs_kHz === 12) {
      this.state.mu_LTP_Q8 = toQ8(TP.MU_LTP_QUANT_MB);
    } else {
      this.state.mu_LTP_Q8 = toQ8(TP.MU_LTP_QUANT_NB);
    }

    // Complexity controls pitch/LPC/LTP behavior; it must be applied per option set.
    this.configureNLSFCodebooks();
    this.setupComplexity(options.complexity ?? this.state.Complexity ?? 2);
  }

  public encode(pcmData: Int16Array, options: EncoderOptions): Uint8Array {
    this.applyOptions(options);
    if (pcmData.length === 0) {
      return new Uint8Array(0);
    }

    const frameLen = this.state.frame_length;
    const payloads: Uint8Array[] = [];

    for (let offset = 0; offset < pcmData.length; offset += frameLen) {
      const frame = new Int16Array(frameLen);
      frame.set(
        pcmData.subarray(offset, Math.min(offset + frameLen, pcmData.length)),
      );
      const outPtr = new Uint8Array(D.MAX_ARITHM_BYTES);
      const nBytesOut = { val: outPtr.length };
      const ret = encodeFrame(this.state, outPtr, nBytesOut, frame);
      if (ret < 0) {
        throw new Error(`SILK Encode Error: ${ret}`);
      }
      if (this.state.sCmn.useDTX && this.state.inDTX) {
        nBytesOut.val = 0;
      }
      if (nBytesOut.val > 0) {
        payloads.push(outPtr.subarray(0, nBytesOut.val));
      }
    }

    // The public encoder API returns finalized packets, so flush an incomplete packet
    // with silence instead of silently dropping the buffered tail.
    while (this.state.nFramesInPayloadBuf > 0) {
      const outPtr = new Uint8Array(D.MAX_ARITHM_BYTES);
      const nBytesOut = { val: outPtr.length };
      const ret = encodeFrame(
        this.state,
        outPtr,
        nBytesOut,
        new Int16Array(frameLen),
      );
      if (ret < 0) {
        throw new Error(`SILK Encode Error: ${ret}`);
      }
      if (this.state.sCmn.useDTX && this.state.inDTX) {
        nBytesOut.val = 0;
      }
      if (nBytesOut.val > 0) {
        payloads.push(outPtr.subarray(0, nBytesOut.val));
      }
    }

    const total = payloads.reduce((sum, p) => sum + p.length, 0);
    const output = new Uint8Array(total);
    let write = 0;
    for (const p of payloads) {
      output.set(p, write);
      write += p.length;
    }
    return output;
  }
}
