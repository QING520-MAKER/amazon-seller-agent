import { Annotation } from "@langchain/langgraph";
import type {
  Intent,
  ListingInput,
  ListingResult,
  ProductBrief,
  ResearchReport,
} from "../schemas.js";

export const AgentState = Annotation.Root({
  intent: Annotation<Intent>(),
  marketplace: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "us",
  }),
  keyword: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  deep: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  compareWith: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  product: Annotation<ProductBrief | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  listingInput: Annotation<ListingInput | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  keywords: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  researchReport: Annotation<ResearchReport | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  listingResult: Annotation<ListingResult | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
});

export type AgentStateType = typeof AgentState.State;
export type AgentUpdate = typeof AgentState.Update;
