import { END, START, StateGraph } from "@langchain/langgraph";
import { afterResearch, listingAuditNode, listingCreateNode, researchNode, routeIntent } from "./nodes.js";
import { AgentState } from "./state.js";

export function buildSellerGraph() {
  return new StateGraph(AgentState)
    .addNode("runResearch", researchNode)
    .addNode("createListing", listingCreateNode)
    .addNode("auditListing", listingAuditNode)
    .addConditionalEdges(START, routeIntent, {
      runResearch: "runResearch",
      createListing: "createListing",
      auditListing: "auditListing",
    })
    .addConditionalEdges("runResearch", afterResearch, {
      createListing: "createListing",
      __end__: END,
    })
    .addEdge("createListing", END)
    .addEdge("auditListing", END)
    .compile();
}

export const sellerGraph = buildSellerGraph();
