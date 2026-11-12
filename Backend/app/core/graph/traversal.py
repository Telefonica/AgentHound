"""Graph traversal helpers (spec section 9).

Paths are bounded by ``max_depth`` (default 8) to avoid combinatorial explosion.
Node-type selectors (untrusted input, sensitive data, external output) read the
normalized node properties.
"""

from __future__ import annotations

import networkx as nx

DEFAULT_MAX_DEPTH = 8

SENSITIVE_LEVELS = {"high", "critical"}


class CapabilityGraph:
    """Thin query layer over a networkx MultiDiGraph built from the IR."""

    def __init__(self, graph: nx.MultiDiGraph, max_depth: int = DEFAULT_MAX_DEPTH) -> None:
        self.graph = graph
        self.max_depth = max_depth

    # --- node selectors -------------------------------------------------
    def _props(self, node_id: str) -> dict:
        return self.graph.nodes[node_id].get("properties", {})

    def nodes_of_type(self, node_type: str) -> list[str]:
        return [n for n, d in self.graph.nodes(data=True) if d.get("type") == node_type]

    def untrusted_inputs(self) -> list[str]:
        return [n for n in self.nodes_of_type("input") if self._props(n).get("trust_level") == "untrusted"]

    def sensitive_assets(self) -> list[str]:
        return [
            n
            for n in self.nodes_of_type("data_asset")
            if self._props(n).get("sensitivity") in SENSITIVE_LEVELS
        ]

    def external_outputs(self) -> list[str]:
        return [n for n in self.nodes_of_type("output") if self._props(n).get("boundary") == "external"]

    # --- reachability & paths -------------------------------------------
    def get_reachable_nodes(self, start_node_id: str) -> set[str]:
        if start_node_id not in self.graph:
            return set()
        # nx.descendants computes every node reachable from the source in a
        # single traversal (source excluded), instead of one has_path per node.
        return set(nx.descendants(self.graph, start_node_id))

    def simple_paths(self, start_id: str, end_id: str) -> list[list[str]]:
        if start_id not in self.graph or end_id not in self.graph:
            return []
        return list(
            nx.all_simple_paths(self.graph, start_id, end_id, cutoff=self.max_depth)
        )

    def find_paths(self, start_type: str = "input", end_type: str = "output") -> list[list[str]]:
        paths: list[list[str]] = []
        for start in self.nodes_of_type(start_type):
            reachable = self.get_reachable_nodes(start)
            for end in self.nodes_of_type(end_type):
                if start == end or end not in reachable:
                    continue
                paths.extend(self.simple_paths(start, end))
        return paths

    def find_paths_containing_capability(self, capability: str) -> list[list[str]]:
        return [p for p in self.find_paths("input", "output") if capability in self.capabilities_on_path(p)]

    def find_paths_from_untrusted_input(self, end_type: str = "output") -> list[list[str]]:
        paths: list[list[str]] = []
        for start in self.untrusted_inputs():
            reachable = self.get_reachable_nodes(start)
            for end in self.nodes_of_type(end_type):
                if end not in reachable:
                    continue
                paths.extend(self.simple_paths(start, end))
        return paths

    def find_paths_to_sensitive_data(self) -> list[list[str]]:
        paths: list[list[str]] = []
        for start in self.untrusted_inputs():
            reachable = self.get_reachable_nodes(start)
            for asset in self.sensitive_assets():
                if asset not in reachable:
                    continue
                paths.extend(self.simple_paths(start, asset))
        return paths

    def find_paths_to_external_output(self) -> list[list[str]]:
        paths: list[list[str]] = []
        for start in self.untrusted_inputs():
            reachable = self.get_reachable_nodes(start)
            for out in self.external_outputs():
                if out not in reachable:
                    continue
                paths.extend(self.simple_paths(start, out))
        return paths

    # --- edge/capability helpers ----------------------------------------
    def hop_capabilities(self, u: str, v: str) -> list[str]:
        if not self.graph.has_edge(u, v):
            return []
        return [d.get("capability") for d in self.graph.get_edge_data(u, v).values()]

    def hop_edge_ids(self, u: str, v: str) -> list[str]:
        if not self.graph.has_edge(u, v):
            return []
        return [k for k in self.graph.get_edge_data(u, v).keys()]

    def hop_edge_ids_for(self, u: str, v: str, capability: str) -> list[str]:
        """Edge ids on the u -> v hop that carry exactly ``capability``."""
        if not self.graph.has_edge(u, v):
            return []
        return [k for k, d in self.graph.get_edge_data(u, v).items() if d.get("capability") == capability]

    def capabilities_on_path(self, path: list[str]) -> set[str]:
        # A path is a node sequence (nx.all_simple_paths enumerates node-paths,
        # not edge-paths), so between two consecutive nodes we consider every
        # parallel capability. For "does capability X occur on this path?" checks
        # this is exactly what the rules want.
        caps: set[str] = set()
        for u, v in zip(path, path[1:]):
            caps.update(self.hop_capabilities(u, v))
        return caps

    def edge_ids_on_path(self, path: list[str]) -> list[str]:
        # Include every parallel edge for each hop. Because a path is a node
        # sequence, a hop with multiple parallel capability edges is ambiguous
        # about which single edge was traversed; we return all of them as a safe
        # over-approximation for highlighting rather than picking one
        # arbitrarily. In Phase 1 inputs there are no parallel edges, so this is
        # exact; precise per-edge attribution would require edge-path tracking.
        edge_ids: list[str] = []
        for u, v in zip(path, path[1:]):
            edge_ids.extend(self.hop_edge_ids(u, v))
        return edge_ids
