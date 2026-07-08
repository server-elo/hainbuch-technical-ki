export interface Recommendation {
  product: string;
  description: string;
  pros?: string[];
  cons?: string[];
  technicalData?: string;
  /** catalogue series photo served by the backend at /product-images/... */
  imageUrl?: string;
}

export interface ChatMessagePart {
  text?: string;
  inlineData?: {
    data: string;
    mimeType: string;
  };
}

export interface ChatMessage {
  role: "user" | "model";
  parts: ChatMessagePart[];
  /** structured pipeline result rendered below the message text (not sent to the API) */
  analysis?: {
    manufacturingAnalysis?: ManufacturingAnalysis | null;
    recommendations?: Recommendation[] | null;
    fitSolutions?: FitSolution[] | null;
    /** deterministic handling-cost comparison between the alternatives */
    costComparison?: CostComparison | null;
    /** deterministic clamping-force traffic light */
    clampingCheck?: ClampingCheck | null;
  };
}

export interface ManufacturingOperation {
  stepName: string;
  operationType: string;
  tool: string;
  cuttingData: string;
  vc?: number;
  feed?: number;
  feedUnit?: string;
  spindleSpeedRpm?: number;
  feedRateMmPerMin: number;
  time: string;
  diameterMm?: number;
  cutLengthMm?: number;
  passes?: number;
  threadPitchMm?: number;
}

export interface MaterialSelection {
  name: string;
  group: string;
  reasoning: string;
}

export interface ManufacturingAnalysis {
  material?: MaterialSelection;
  fastestMethod: string;
  costEffectiveMethod: string;
  rawMaterialRecommendation?: string;
  clampingStrategy?: string;
  viseMachiningPlan?: string;
  operations: ManufacturingOperation[];
  totalEstimatedMachiningTime: string;
  ragSources?: string[];
}

export interface CostAlternative {
  product: string;
  actuation: string;
  clampMinPerPart: number;
  handlingMinSeries: number;
  handlingCostSeriesEur: number;
  extraVsBestEur: number;
}

export interface CostComparison {
  batchSize: number;
  hourlyRateEur: number;
  hourlyRateAssumed: boolean;
  alternatives: CostAlternative[];
  note: string;
}

export interface ClampingCheck {
  maxCuttingForceN: number;
  decisiveOp: string;
  requiredClampForceKn: number;
  safetyFactor: number;
  frictionCoeff: number;
  kcUsed: number;
  products: Array<{
    product: string;
    catalogForceKn: number | null;
    ratio: number | null;
    verdict: 'passt' | 'knapp' | 'zu klein' | 'unbekannt';
  }>;
  note: string;
}

export interface FitSolution {
  designation: string;
  fitType: string;
  holeGo: number;
  holeGu: number;
  shaftGo: number;
  shaftGu: number;
  psh: number;
  puh: number;
}

export interface ChatResponse {
  message: string;
  manufacturingAnalysis?: ManufacturingAnalysis | null;
  recommendations?: Recommendation[] | null;
  fitSolutions?: FitSolution[];
}

export interface PipelineStatus {
  stage: string;
  label: string;
  infos: string[];
  /** full chronological log of every pipeline event (for the thinking box) */
  log: string[];
  startedAt: number;
}



