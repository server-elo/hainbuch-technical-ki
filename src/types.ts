export interface Recommendation {
  product: string;
  description: string;
  technicalData?: string;
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

export interface AssessmentData {
  machineType: string;
  projectRequirements: string;
  technicalConstraints: string;
  desiredOutcomes: string;
  budget: string;
}

