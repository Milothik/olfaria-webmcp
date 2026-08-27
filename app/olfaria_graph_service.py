"""Servicios deterministas del grafo para la capa WebMCP de Olfaria.

Este módulo no modifica el corpus. Sus salidas distinguen los datos presentes
en el corpus de los cálculos reproducibles derivados de esos datos.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import olfaria_corpus as corpus


class GraphServiceError(ValueError):
    """Error de dominio con código estable y detalles auditables."""

    def __init__(self, code: str, message: str, *, details: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def as_detail(self) -> dict:
        return {"code": self.code, "message": self.message, **self.details}


@dataclass(frozen=True)
class _EdgeStep:
    previous: str
    relation_id: str


class OlfariaGraphService:
    """Índices y operaciones de lectura sobre el corpus normalizado."""

    def __init__(self, data_loader: Callable[[], dict] = corpus.load_data):
        self._data_loader = data_loader
        self._data_identity: Optional[int] = None
        self._olfemas: Dict[str, dict] = {}
        self._relations: Dict[str, dict] = {}
        self._aliases: Dict[str, str] = {}
        self._labels: Dict[str, List[str]] = {}
        self._adjacency: Dict[str, List[Tuple[str, str]]] = {}
        self._search_docs: Dict[str, dict] = {}

    @staticmethod
    def _identity_key(value: Any) -> str:
        return str(value or "").strip().casefold()

    @staticmethod
    def _unique_strings(values: Iterable[Any]) -> List[str]:
        seen = set()
        result: List[str] = []
        for value in values:
            text = str(value or "").strip()
            key = corpus.normalize_text(text)
            if not text or key in seen:
                continue
            seen.add(key)
            result.append(text)
        return result

    def _ensure_indexes(self) -> dict:
        data = self._data_loader()
        if id(data) == self._data_identity:
            return data

        olfemas = {o["id"]: o for o in data.get("olfemas", []) if o.get("id")}
        relations = {r["id"]: r for r in data.get("relations", []) if r.get("id")}
        aliases: Dict[str, str] = {}
        labels: Dict[str, List[str]] = defaultdict(list)
        search_docs: Dict[str, dict] = {}

        for olid, olfema in olfemas.items():
            for value in (olid, olfema.get("id_key"), olfema.get("olfaria_code")):
                key = self._identity_key(value)
                if key:
                    aliases[key] = olid
            label_key = corpus.normalize_text(olfema.get("label", ""))
            if label_key:
                labels[label_key].append(olid)
            synonyms = [corpus.normalize_text(v) for v in olfema.get("synonyms") or []]
            materials = [
                corpus.normalize_text(v)
                for v in olfema.get("related_ingredients_or_materials") or []
            ]
            search_docs[olid] = {
                "label": label_key,
                "code": corpus.normalize_text(olfema.get("olfaria_code", "")),
                "id_key": corpus.normalize_text(olfema.get("id_key", "")),
                "family": corpus.normalize_text(olfema.get("family", "")),
                "facet": corpus.normalize_text(olfema.get("facet", "")),
                "synonyms": synonyms,
                "materials": materials,
                "haystack": " ".join([
                    label_key,
                    corpus.normalize_text(olfema.get("olfaria_code", "")),
                    corpus.normalize_text(olfema.get("id_key", "")),
                    corpus.normalize_text(olfema.get("family", "")),
                    corpus.normalize_text(olfema.get("facet", "")),
                    *synonyms,
                    *materials,
                ]),
            }

        adjacency: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
        for rid, relation in relations.items():
            source = relation.get("source")
            target = relation.get("target")
            if source not in olfemas or target not in olfemas:
                continue
            adjacency[source].append((target, rid))
            adjacency[target].append((source, rid))

        for olid in adjacency:
            adjacency[olid].sort(key=lambda item: (item[0], item[1]))

        self._data_identity = id(data)
        self._olfemas = olfemas
        self._relations = relations
        self._aliases = aliases
        self._labels = dict(labels)
        self._adjacency = dict(adjacency)
        self._search_docs = search_docs
        return data

    def _resolve(self, identifier: str) -> str:
        self._ensure_indexes()
        value = str(identifier or "").strip()
        if not value:
            raise GraphServiceError("invalid_identifier", "El identificador no puede estar vacío.")

        resolved = self._aliases.get(self._identity_key(value))
        if resolved:
            return resolved

        label_matches = self._labels.get(corpus.normalize_text(value), [])
        if len(label_matches) == 1:
            return label_matches[0]
        if len(label_matches) > 1:
            candidates = [self._olfemas[item].get("olfaria_code", item) for item in label_matches[:10]]
            raise GraphServiceError(
                "ambiguous_identifier",
                "La etiqueta coincide con varios olfemas; usa codigo o id_key.",
                details={"identifier": value, "candidates": candidates},
            )
        raise GraphServiceError(
            "olfema_not_found",
            "No existe un olfema con ese codigo, id_key o etiqueta exacta.",
            details={"identifier": value},
        )

    @staticmethod
    def _olfema_view(olfema: dict) -> dict:
        """Vista con los campos oficiales del corpus, sin inventar atributos."""
        return {
            "codigo": olfema.get("olfaria_code", ""),
            "id_key": olfema.get("id_key", ""),
            "etiqueta": olfema.get("label", ""),
            "familia": olfema.get("family", "unknown"),
            "faceta": olfema.get("facet") or "",
            "fase": olfema.get("typical_phase", "ambient"),
            "intensidad": olfema.get("intensity_range", [1, 3]),
            "polaridad": olfema.get("polarity", 0.0),
            "sinonimos": list(olfema.get("synonyms") or []),
            "ingredientes_materiales": list(
                olfema.get("related_ingredients_or_materials") or []
            ),
            "procedencia": list(olfema.get("procedencia") or []),
            "incertidumbre": olfema.get("incertidumbre"),
            "codigo_original": olfema.get("codigo_original"),
        }

    @staticmethod
    def _relation_view(relation: dict) -> dict:
        return {
            "relacion": relation.get("id", ""),
            "origen": relation.get("source", ""),
            "predicado": relation.get("predicate", ""),
            "destino": relation.get("target", ""),
            "confianza": relation.get("confidence", 0.5),
            "peso": relation.get("weight"),
            "incertidumbre": relation.get("uncertainty"),
            "fase": relation.get("phase"),
            "racional_comentario": relation.get("rationale", ""),
        }

    def search(self, query: str, *, limit: int = 8) -> dict:
        self._ensure_indexes()
        query = str(query or "").strip()
        if not query:
            raise GraphServiceError("invalid_query", "La búsqueda no puede estar vacía.")
        if len(query) > 120:
            raise GraphServiceError("invalid_query", "La búsqueda no puede superar 120 caracteres.")
        limit = max(1, min(int(limit), 20))
        qnorm = corpus.normalize_text(query)
        qtokens = [token for token in qnorm.split() if token]

        scored: List[Tuple[int, str, dict]] = []
        for olid, olfema in self._olfemas.items():
            search_doc = self._search_docs[olid]
            label = search_doc["label"]
            code = search_doc["code"]
            id_key = search_doc["id_key"]
            family = search_doc["family"]
            facet = search_doc["facet"]
            synonyms = search_doc["synonyms"]
            materials = search_doc["materials"]
            haystack = search_doc["haystack"]

            score = 0
            if qnorm in (code, id_key):
                score = 120
            elif qnorm == label:
                score = 110
            elif qnorm in synonyms:
                score = 100
            elif label.startswith(qnorm):
                score = 90
            elif qnorm in label:
                score = 80
            elif qnorm == family or qnorm == facet:
                score = 70
            elif qnorm in materials:
                score = 65
            elif qtokens and all(token in haystack for token in qtokens):
                score = 50 + min(len(qtokens), 10)
            if score:
                scored.append((score, olfema.get("olfaria_code", olid), olfema))

        scored.sort(key=lambda item: (-item[0], item[1]))
        results = []
        for score, _, olfema in scored[:limit]:
            results.append({
                "olfema": self._olfema_view(olfema),
                "score_busqueda": score,
            })
        return {
            "query": query,
            "count": len(results),
            "total_matches": len(scored),
            "olfemas": results,
            "clasificacion": "dato_validado",
        }

    def relations(self, identifier: str, *, depth: int = 1, limit: int = 30) -> dict:
        self._ensure_indexes()
        depth = max(1, min(int(depth), 2))
        limit = max(1, min(int(limit), 50))
        root = self._resolve(identifier)
        frontier = [root]
        visited_nodes = {root}
        relation_ids: List[str] = []
        seen_relations = set()
        truncated = False

        for _ in range(depth):
            next_frontier: List[str] = []
            for node_id in sorted(frontier):
                for neighbor, relation_id in self._adjacency.get(node_id, []):
                    if relation_id not in seen_relations:
                        if len(relation_ids) >= limit:
                            truncated = True
                            break
                        seen_relations.add(relation_id)
                        relation_ids.append(relation_id)
                    if neighbor not in visited_nodes:
                        visited_nodes.add(neighbor)
                        next_frontier.append(neighbor)
                if truncated:
                    break
            if truncated:
                break
            frontier = next_frontier
            if not frontier:
                break

        relation_ids.sort(
            key=lambda rid: (
                -float(self._relations[rid].get("confidence") or 0),
                rid,
            )
        )
        return {
            "olfema": self._olfema_view(self._olfemas[root]),
            "depth": depth,
            "relations": [self._relation_view(self._relations[rid]) for rid in relation_ids],
            "nodes": [self._olfema_view(self._olfemas[nid]) for nid in sorted(visited_nodes)],
            "truncated": truncated,
            "clasificacion": "dato_validado",
        }

    @staticmethod
    def _shared_values(first: Sequence[Any], second: Sequence[Any]) -> List[str]:
        second_keys = {corpus.normalize_text(value) for value in second}
        return OlfariaGraphService._unique_strings(
            value for value in first if corpus.normalize_text(value) in second_keys
        )

    def compare(self, first_identifier: str, second_identifier: str) -> dict:
        self._ensure_indexes()
        first_id = self._resolve(first_identifier)
        second_id = self._resolve(second_identifier)
        if first_id == second_id:
            raise GraphServiceError(
                "same_olfema",
                "La comparación requiere dos olfemas distintos.",
                details={"identifier": first_identifier},
            )
        first = self._olfemas[first_id]
        second = self._olfemas[second_id]

        shared: Dict[str, Any] = {}
        for official, internal in (
            ("familia", "family"),
            ("faceta", "facet"),
            ("fase", "typical_phase"),
        ):
            left = first.get(internal)
            right = second.get(internal)
            if left and corpus.normalize_text(left) == corpus.normalize_text(right):
                shared[official] = left

        shared_synonyms = self._shared_values(first.get("synonyms") or [], second.get("synonyms") or [])
        shared_materials = self._shared_values(
            first.get("related_ingredients_or_materials") or [],
            second.get("related_ingredients_or_materials") or [],
        )
        if shared_synonyms:
            shared["sinonimos"] = shared_synonyms
        if shared_materials:
            shared["ingredientes_materiales"] = shared_materials

        direct_relation_ids = {
            relation_id
            for neighbor, relation_id in self._adjacency.get(first_id, [])
            if neighbor == second_id
        }
        differences = {
            field: {
                "primer_olfema": first.get(internal),
                "segundo_olfema": second.get(internal),
            }
            for field, internal in (
                ("familia", "family"),
                ("faceta", "facet"),
                ("fase", "typical_phase"),
                ("intensidad", "intensity_range"),
                ("polaridad", "polarity"),
            )
            if first.get(internal) != second.get(internal)
        }

        return {
            "primer_olfema": self._olfema_view(first),
            "segundo_olfema": self._olfema_view(second),
            "coincidencias": shared,
            "diferencias": differences,
            "relaciones_directas": [
                self._relation_view(self._relations[rid]) for rid in sorted(direct_relation_ids)
            ],
            "clasificacion": {
                "olfemas": "dato_validado",
                "comparacion": "inferencia_tecnica_determinista",
            },
        }

    def find_path(self, source_identifier: str, target_identifier: str, *, max_depth: int = 5) -> dict:
        self._ensure_indexes()
        max_depth = max(1, min(int(max_depth), 6))
        source = self._resolve(source_identifier)
        target = self._resolve(target_identifier)
        if source == target:
            return {
                "found": True,
                "source": self._olfema_view(self._olfemas[source]),
                "target": self._olfema_view(self._olfemas[target]),
                "nodes": [self._olfema_view(self._olfemas[source])],
                "relations": [],
                "hops": 0,
                "clasificacion": "inferencia_tecnica_determinista",
            }

        queue = deque([(source, 0)])
        visited = {source}
        previous: Dict[str, _EdgeStep] = {}
        found = False

        while queue:
            current, depth = queue.popleft()
            if depth >= max_depth:
                continue
            for neighbor, relation_id in self._adjacency.get(current, []):
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                previous[neighbor] = _EdgeStep(current, relation_id)
                if neighbor == target:
                    found = True
                    queue.clear()
                    break
                queue.append((neighbor, depth + 1))

        if not found:
            return {
                "found": False,
                "source": self._olfema_view(self._olfemas[source]),
                "target": self._olfema_view(self._olfemas[target]),
                "nodes": [],
                "relations": [],
                "hops": None,
                "max_depth": max_depth,
                "clasificacion": "inferencia_tecnica_determinista",
            }

        node_ids = [target]
        relation_ids: List[str] = []
        cursor = target
        while cursor != source:
            step = previous[cursor]
            relation_ids.append(step.relation_id)
            cursor = step.previous
            node_ids.append(cursor)
        node_ids.reverse()
        relation_ids.reverse()

        return {
            "found": True,
            "source": self._olfema_view(self._olfemas[source]),
            "target": self._olfema_view(self._olfemas[target]),
            "nodes": [self._olfema_view(self._olfemas[nid]) for nid in node_ids],
            "relations": [self._relation_view(self._relations[rid]) for rid in relation_ids],
            "hops": len(relation_ids),
            "max_depth": max_depth,
            "clasificacion": "inferencia_tecnica_determinista",
        }
