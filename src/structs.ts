/**
 * SILK v3 Decoder State Structures
 * Ported from SKP_Silk_structs.h
 */
import { RangeCoderState } from './range_coder';
import type { NLSFCB } from './nlsf';
import {
    MAX_FRAME_LENGTH, MAX_LPC_ORDER, MAX_ARITHM_BYTES,
    LTP_ORDER, NB_SUBFR, DEC_HP_ORDER, NB_LTP_CBKS,
    NLSF_MSVQ_MAX_CB_STAGES, CNG_BUF_MASK_MAX, MAX_SHAPE_LPC_ORDER
} from './defines';

export interface DecoderControl {
    pitchL: Int32Array;           // [NB_SUBFR]
    Gains_Q16: Int32Array;        // [NB_SUBFR]
    Seed: number;
    PredCoef_Q12: Int16Array[];   // [2][MAX_LPC_ORDER]
    LTPCoef_Q14: Int16Array;      // [LTP_ORDER * NB_SUBFR]
    LTP_scale_Q14: number;
    PERIndex: number;
    RateLevelIndex: number;
    QuantOffsetType: number;
    sigtype: number;
    NLSFInterpCoef_Q2: number;
}

export function createDecoderControl(): DecoderControl {
    return {
        pitchL: new Int32Array(NB_SUBFR),
        Gains_Q16: new Int32Array(NB_SUBFR),
        Seed: 0,
        PredCoef_Q12: [new Int16Array(MAX_LPC_ORDER), new Int16Array(MAX_LPC_ORDER)],
        LTPCoef_Q14: new Int16Array(LTP_ORDER * NB_SUBFR),
        LTP_scale_Q14: 0,
        PERIndex: 0,
        RateLevelIndex: 0,
        QuantOffsetType: 0,
        sigtype: 0,
        NLSFInterpCoef_Q2: 0,
    };
}

export class DecoderState {
    sRC = new RangeCoderState();
    prev_inv_gain_Q16: number = 1;
    sLTP_Q16 = new Int32Array(2 * MAX_FRAME_LENGTH);
    sLPC_Q14 = new Int32Array(MAX_FRAME_LENGTH / NB_SUBFR + MAX_LPC_ORDER);
    exc_Q10 = new Int32Array(MAX_FRAME_LENGTH);
    res_Q10 = new Int32Array(MAX_FRAME_LENGTH);
    outBuf = new Int16Array(2 * MAX_FRAME_LENGTH);
    lagPrev: number = 0;
    LastGainIndex: number = 0;
    LastGainIndex_EnhLayer: number = 0;
    typeOffsetPrev: number = 0;
    HPState = new Int32Array(DEC_HP_ORDER);
    HP_A: Int16Array = new Int16Array(0);
    HP_B: Int16Array = new Int16Array(0);
    fs_kHz: number = 0;
    prev_API_sampleRate: number = 0;
    resamplerStateIIR = new Int32Array(6);
    frame_length: number = 0;
    subfr_length: number = 0;
    LPC_order: number = 0;
    prevNLSF_Q15 = new Int32Array(MAX_LPC_ORDER);
    first_frame_after_reset: number = 1;
    nBytesLeft: number = 0;
    nFramesDecoded: number = 0;
    nFramesInPacket: number = 0;
    moreInternalDecoderFrames: number = 0;
    FrameTermination: number = 0;
    vadFlag: number = 0;
    no_FEC_counter: number = 0;
    inband_FEC_offset: number = 0;
    lossCnt: number = 0;
    prev_sigtype: number = 0;
    // NLSF codebook pointers [voiced, unvoiced]
    psNLSF_CB: (NLSFCB | null)[] = [null, null];
    // CNG state
    CNG_exc_buf_Q10 = new Int32Array(MAX_FRAME_LENGTH);
    CNG_smth_NLSF_Q15 = new Int32Array(MAX_LPC_ORDER);
    CNG_synth_state = new Int32Array(MAX_LPC_ORDER);
    CNG_smth_Gain_Q16: number = 0;
    CNG_rand_seed: number = 0;
    CNG_fs_kHz: number = 0;
    // PLC state
    PLC_pitchL_Q8: number = 0;
    PLC_LTPCoef_Q14 = new Int16Array(LTP_ORDER);
    PLC_prevLPC_Q12 = new Int16Array(MAX_LPC_ORDER);
    PLC_last_frame_lost: number = 0;
    PLC_rand_seed: number = 0;
    PLC_randScale_Q14: number = 0;
    PLC_conc_energy: number = 0;
    PLC_conc_energy_shift: number = 0;
    PLC_prevLTP_scale_Q14: number = 0;
    PLC_prevGain_Q16 = new Int32Array(NB_SUBFR);
    PLC_fs_kHz: number = 0;
}

export class EncoderControl {
    // Prediction and coding parameters
    public Gains_Q16: Int32Array = new Int32Array(NB_SUBFR);
    public PredCoef_Q12: Int16Array = new Int16Array(2 * MAX_LPC_ORDER);
    public LTPCoef_Q14: Int16Array = new Int16Array(LTP_ORDER * NB_SUBFR);
    public LTP_scale_Q14: number = 0;

    public ResNrg: Int32Array = new Int32Array(NB_SUBFR);
    public ResNrgQ: Int32Array = new Int32Array(NB_SUBFR);
    public LTPredCodGain_Q7: number = 0;
    public NLSFInterpCoef_Q2: number = 0;

    // Noise shaping parameters
    public AR1_Q13: Int16Array = new Int16Array(NB_SUBFR * MAX_SHAPE_LPC_ORDER);
    public AR2_Q13: Int16Array = new Int16Array(NB_SUBFR * MAX_SHAPE_LPC_ORDER);
    public LF_shp_Q14: Int32Array = new Int32Array(NB_SUBFR);
    public GainsPre_Q14: Int32Array = new Int32Array(NB_SUBFR);
    public HarmBoost_Q14: Int32Array = new Int32Array(NB_SUBFR);
    public Tilt_Q14: Int32Array = new Int32Array(NB_SUBFR);
    public HarmShapeGain_Q14: Int32Array = new Int32Array(NB_SUBFR);
    public Lambda_Q10: number = 0;
    public input_quality_Q14: number = 0;
    public coding_quality_Q14: number = 0;
    public input_quality_bands_Q15: Int32Array = new Int32Array(4); // VAD_N_BANDS
    public pitch_freq_low_Hz: number = 0;
    public current_SNR_dB_Q7: number = 0;

    // Extracted from common control
    public sigtype: number = 0;
    public QuantOffsetType: number = 0;
    public pitchL: Int32Array = new Int32Array(NB_SUBFR);
    public LBRR_usage: number = 0;
    public Seed: number = 0;
    public PERIndex: number = 0;
    public LTPIndex: Int32Array = new Int32Array(NB_SUBFR);
    public LTP_scaleIndex: number = 0;
    public GainsIndices: Int32Array = new Int32Array(NB_SUBFR);
    public NLSFIndices: Int32Array = new Int32Array(NLSF_MSVQ_MAX_CB_STAGES);

    // Pitch estimation output fields
    public lagIndex: number = 0;
    public contourIndex: number = 0;
    public predGain_Q16: number = 0;
    public input_tilt_Q15: number = 0;
}

export class EncoderState {
    // Extracted from SKP_Silk_encoder_state (sCmn)
    public frameCounter: number = 0;
    public fs_kHz: number = 0;
    public frame_length: number = 0;
    public subfr_length: number = 0;
    public la_pitch: number = 0;
    public la_shape: number = 0;
    public shapeWinLength: number = 0;
    public shapingLPCOrder: number = 16;
    public TargetRate_bps: number = 0;
    public PacketSize_ms: number = 0;
    public nFramesInPayloadBuf: number = 0;
    public nBytesInPayloadBuf: number = 0;
    public vadFlag: number = 0;
    public inDTX: number = 0;
    public noSpeechCounter: number = 0;
    public Complexity: number = 0;
    public nStatesDelayedDecision: number = 0;
    public warping_Q16: number = 0;
    public oldest_LBRR_idx: number = 0;
    public LBRR_enabled: number = 0;
    public LBRR_GainIncreases: number = 0;
    public useInBandFEC: number = 0;

    public typeOffsetPrev: number = 0;
    public prevLag: number = 0;
    public prev_sigtype: number = 1;
    public first_frame_after_reset: number = 0;

    // Buffers and Sub-states
    public x_buf: Int16Array = new Int16Array(2 * MAX_FRAME_LENGTH + 120); // LA_SHAPE_MAX = 120
    public sRC: any = {}; // Range coder state
    public sRC_LBRR: any = {};
    public sNSQ: any = {}; // NSQ state
    public sNSQ_LBRR: any = {};
    public sVAD: any = {}; // VAD state
    public sSWBdetect: any = {};
    public LBRR_buffer: any[] = [];
    public q: Int8Array = new Int8Array(MAX_FRAME_LENGTH);
    public q_LBRR: Int8Array = new Int8Array(MAX_FRAME_LENGTH);

    // Extracted from SKP_Silk_encoder_state_FIX
    public speech_activity_Q8: number = 0;
    public BufferedInChannel_ms: number = 0;
    public SNR_dB_Q7: number = 0;
    public avgGain_Q16: number = 0;
    public avgGain_Q16_one_bit_per_sample: number = 0;

    public variable_HP_smth1_Q15: number = 0;
    public variable_HP_smth2_Q15: number = 0;

    // Pitch estimation tuning parameters in state
    public LTPCorr_Q15: number = 0;
    public pitchEstimationThreshold_Q16: number = 0;
    public pitchEstimationComplexity: number = 0;
    public pitchEstimationLPCOrder: number = 16;

    public sShape: any = {};
    public sPrefilt: any = {};
    public sPred: any = {};
    public sCmn: any = {
        sLP: {
            In_LP_State: new Int32Array(2),
            transition_frame_no: 0,
            mode: 0
        },
        In_HP_State: new Int32Array(2)
    };
}

export interface LPState {
    In_LP_State: Int32Array;
    transition_frame_no: number;
    mode: number;
}
