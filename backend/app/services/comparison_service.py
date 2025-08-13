"""Service for comparing ground truth with API responses and calculating metrics."""
from typing import Dict, List, Any, Tuple, Callable
import os
import json
import Levenshtein
from pydantic import BaseModel


class EvaluationMetrics(BaseModel):
    true_positives: int
    false_positives: int
    false_negatives: int
    true_negatives: int
    precision: float
    recall: float
    f1_score: float
    accuracy: float


def normalize_value_for_comparison(value: Any) -> str:
    """Convert any value to a normalized lowercase string for comparison."""
    if value is None:
        return ""
    elif isinstance(value, str):
        return value.strip().lower()
    elif isinstance(value, (int, float, bool)):
        return str(value).lower()
    elif isinstance(value, list):
        return ", ".join(normalize_value_for_comparison(item) for item in value)
    elif isinstance(value, dict):
        pairs = []
        for k, v in sorted(value.items()):
            pairs.append(f"{k}:{normalize_value_for_comparison(v)}")
        return "; ".join(pairs)
    else:
        return str(value).strip().lower()


def calculate_exact_similarity(expected: Any, actual: Any) -> float:
    """Return 1.0 if normalized strings match exactly, else 0.0."""
    exp_str = normalize_value_for_comparison(expected)
    act_str = normalize_value_for_comparison(actual)
    return 1.0 if exp_str == act_str else 0.0


def _load_schema(schema_path: str) -> Dict[str, Any]:
    try:
        with open(schema_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _discover_array_key_fields(schema: Dict[str, Any]) -> Dict[str, List[str]]:
    """Walk a simple schema to find arrays and return mapping of path -> list of fields in the array item object.
    Expects arrays to be represented as a list with a single dict item describing the item shape."""
    path_to_keys: Dict[str, List[str]] = {}

    def walk(node: Any, path: str = ""):
        if isinstance(node, dict):
            for k, v in node.items():
                sub_path = f"{path}.{k}" if path else k
                walk(v, sub_path)
        elif isinstance(node, list) and node:
            item = node[0]
            if isinstance(item, dict):
                # Use all item keys as the default semantic key components
                path_to_keys[path] = list(item.keys())
                # Also recurse into the item in case of nested arrays/objects
                walk(item, path)

    walk(schema)
    return path_to_keys


def _build_selector(key_fields: List[str]) -> Callable[[Dict[str, Any]], str]:
    def selector(obj: Dict[str, Any]) -> str:
        parts: List[str] = []
        for field in key_fields:
            val = obj.get(field, "")
            # light normalization for strings
            if isinstance(val, str):
                s = val.strip().lower()
                s = s.replace("  ", " ")
                s = s.replace(" per day", "/day")
                parts.append(s)
            else:
                parts.append(normalize_value_for_comparison(val))
        return "|".join(parts)
    return selector


# Build ARRAY_KEY_FIELDS dynamically from schema (env override possible)
_ARRAY_KEY_SELECTORS: Dict[str, Callable[[Dict[str, Any]], str]] = {}
try:
    schema_path = os.environ.get(
        "SCHEMA_JSON_PATH",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "src", "schema.json")),
    )
    schema = _load_schema(schema_path)
    # If the frontend path isn't available in deployment, allow a second default: backend/app/core/schema.json
    if not schema:
        fallback_backend = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "core", "schema.json"))
        schema = _load_schema(fallback_backend)

    array_key_fields = _discover_array_key_fields(schema)
    for array_path, keys in array_key_fields.items():
        # Only create selectors for arrays whose items are dicts
        if isinstance(keys, list) and keys:
            # Use ONLY the first field in the array item as the stable key
            _ARRAY_KEY_SELECTORS[array_path] = _build_selector([keys[0]])
except Exception:
    _ARRAY_KEY_SELECTORS = {}

# Safe fallback if schema not found or empty
if not _ARRAY_KEY_SELECTORS:
    _ARRAY_KEY_SELECTORS = {
        # sensible defaults matching the provided schema
        "medications.medications": _build_selector(["med_name", "dosage", "med_sig"]),
        "icd10_codes.codes": _build_selector(["code"]),
    }


def filter_ground_truth_by_extraction_types(ground_truth: Dict[str, Any], extraction_types: List[str]) -> Dict[str, Any]:
    """
    Filter ground truth to only include the specified extraction types.
    This ensures that unselected extraction types don't contribute to false negatives.
    """
    if not extraction_types:
        return ground_truth
    
    filtered_gt = {}
    for ext_type in extraction_types:
        if ext_type in ground_truth:
            filtered_gt[ext_type] = ground_truth[ext_type]
    
    return filtered_gt


def remove_excluded_fields_from_ground_truth(ground_truth: Dict[str, Any], excluded_fields: List[str]) -> Dict[str, Any]:
    """
    Remove excluded fields from ground truth based on JSON pointer paths.
    This ensures that excluded fields don't contribute to false negatives.
    Supports both specific indices (/medications/medications/0/frequency) and 
    wildcards for all array items (/medications/medications/frequency).
    """
    if not excluded_fields:
        return ground_truth
    
    import copy
    import logging
    
    logger = logging.getLogger(__name__)
    
    # Deep copy to avoid modifying original
    filtered_gt = copy.deepcopy(ground_truth)
    excluded_count = 0
    
    logger.debug(f"🔍 Excluding {len(excluded_fields)} field patterns from ground truth: {excluded_fields}")
    
    # Sort excluded fields by depth (deeper paths first) to avoid issues with deleting parent paths
    sorted_excluded = sorted(excluded_fields, key=lambda x: x.count('/'), reverse=True)
    
    for json_pointer in sorted_excluded:
        try:
            # Parse JSON pointer path (e.g., "/medications/medications/0/frequency")
            path_parts = [part for part in json_pointer.split('/') if part]
            
            if not path_parts:
                continue
            
            excluded_count += _remove_field_recursive(filtered_gt, path_parts, json_pointer)
                        
        except (ValueError, TypeError, KeyError, IndexError) as e:
            logger.warning(f"⚠️ Warning: Could not remove excluded field {json_pointer}: {e}")
            continue
    
    logger.debug(f"✅ Successfully excluded {excluded_count} field instances from ground truth")
    return filtered_gt


def _remove_field_recursive(data: Any, path_parts: List[str], original_path: str, current_path: str = "") -> int:
    """
    Recursively remove fields, handling both specific indices and wildcard array removal.
    Returns the number of fields actually removed.
    """
    if not path_parts:
        return 0
    
    import logging
    logger = logging.getLogger(__name__)
    
    removed_count = 0
    current_part = path_parts[0]
    remaining_parts = path_parts[1:]
    
    if len(remaining_parts) == 0:
        # This is the final field to remove
        if isinstance(data, dict) and current_part in data:
            del data[current_part]
            logger.debug(f"  ✓ Removed field: {current_path}/{current_part}")
            return 1
        elif isinstance(data, list) and current_part.isdigit():
            idx = int(current_part)
            if 0 <= idx < len(data):
                data.pop(idx)
                logger.debug(f"  ✓ Removed array item: {current_path}[{idx}]")
                return 1
        elif isinstance(data, list) and not current_part.isdigit():
            # Final field removal from ALL array items (wildcard case)
            logger.debug(f"  🎯 Removing field '{current_part}' from all {len(data)} array items")
            for i, item in enumerate(data):
                if isinstance(item, dict) and current_part in item:
                    del item[current_part]
                    logger.debug(f"    ✓ Removed {current_path}[{i}]/{current_part}")
                    removed_count += 1
            return removed_count
        return 0
    
    # Navigate deeper
    if isinstance(data, dict) and current_part in data:
        # Navigate into dict
        new_path = f"{current_path}/{current_part}" if current_path else current_part
        removed_count += _remove_field_recursive(data[current_part], remaining_parts, original_path, new_path)
        
    elif isinstance(data, list):
        if current_part.isdigit():
            # Specific array index
            idx = int(current_part)
            if 0 <= idx < len(data):
                new_path = f"{current_path}[{idx}]"
                removed_count += _remove_field_recursive(data[idx], remaining_parts, original_path, new_path)
        else:
            # Non-numeric part after array - apply to ALL array items (wildcard behavior)
            logger.debug(f"  🎯 Applying wildcard pattern '{current_part}' to all {len(data)} array items")
            for i, item in enumerate(data):
                new_path = f"{current_path}[{i}]"
                removed_count += _remove_field_recursive(item, [current_part] + remaining_parts, original_path, new_path)
    
    return removed_count


# Define semantic key selectors dynamically
ARRAY_KEY_FIELDS: Dict[str, Callable[[Dict[str, Any]], str]] = _ARRAY_KEY_SELECTORS


def flatten_json_for_comparison(data: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """
    Flatten nested JSON into a key->value map.
    - Uses semantic keys for certain arrays (via ARRAY_KEY_FIELDS) instead of numeric indexes.
    - Collects multiple values under the same key into lists.
    """
    flat: Dict[str, Any] = {}

    for key, value in data.items():
        full_key = f"{prefix}.{key}" if prefix else key

        # 1) Keyed-array support
        selector = ARRAY_KEY_FIELDS.get(full_key)
        if selector and isinstance(value, list):
            for item in value:
                semantic = selector(item)
                item_prefix = f"{full_key}[{semantic}]"
                subflat = flatten_json_for_comparison(item, item_prefix)
                for subk, subv in subflat.items():
                    if subk in flat:
                        if isinstance(flat[subk], list):
                            flat[subk].append(subv)
                        else:
                            flat[subk] = [flat[subk], subv]
                    else:
                        flat[subk] = subv
            continue

        # 2) Recurse into dicts
        if isinstance(value, dict):
            flat.update(flatten_json_for_comparison(value, full_key))

        # 3) Index-based flattening for other lists
        elif isinstance(value, list):
            if value:
                for i, item in enumerate(value):
                    idx_prefix = f"{full_key}[{i}]"
                    if isinstance(item, dict):
                        flat.update(flatten_json_for_comparison(item, idx_prefix))
                    else:
                        flat[idx_prefix] = item
            else:
                flat[f"{full_key}._empty"] = True

        # 4) Scalars & nulls
        elif value is None:
            flat[f"{full_key}._empty"] = True
        else:
            flat[full_key] = value

    return flat


def compare_extraction_results(
    ground_truth: Dict[str, Any],
    api_response: Dict[str, Any]
) -> Tuple[Dict[str, float], List[str], int]:
    """
    Compare GT vs API response field‑by‑field.
    Returns (scores, mismatches, true_negatives).
    
    Score meanings:
    - 1.0: True Positive (perfect match)
    - 0.5-0.99: True Positive (partial match, but still correct extraction)
    - -1.0: False Positive (unexpected field or wrong value)
    - -2.0: False Negative (missing expected field)
    """
    scores: Dict[str, float] = {}
    mismatches: List[str] = []
    true_negatives = 0

    gt_flat = flatten_json_for_comparison(ground_truth)
    api_flat_raw = flatten_json_for_comparison(api_response.get("extracted_data", {}))

    # Treat empty strings from API as null/missing to avoid counting FP/FN for "" values
    api_flat: Dict[str, Any] = {}
    for k, v in api_flat_raw.items():
        # Drop scalar empty strings entirely (treat as missing)
        if isinstance(v, str) and v.strip() == "":
            continue
        # For lists, remove empty-string items
        if isinstance(v, list):
            cleaned_list = []
            for item in v:
                if isinstance(item, str) and item.strip() == "":
                    continue
                cleaned_list.append(item)
            v = cleaned_list
        api_flat[k] = v
    all_keys = set(gt_flat) | set(api_flat)

    for key in all_keys:
        exp = gt_flat.get(key)
        act = api_flat.get(key)

        # Handle list comparisons
        if isinstance(exp, list) or isinstance(act, list):
            exp_list = exp if isinstance(exp, list) else [exp] if exp is not None else []
            act_list = act if isinstance(act, list) else [act] if act is not None else []
            
            # Compare each expected item
            for exp_item in exp_list:
                if exp_item in act_list:
                    # True Positive: expected item found
                    item_key = f"{key}[{exp_item}]"
                    scores[item_key] = 1.0
                else:
                    # False Negative: expected item missing
                    item_key = f"{key}[{exp_item}]"
                    scores[item_key] = -2.0
                    mismatches.append(f"[FN] {item_key}: missing (expected='{exp_item}')")
            
            # Check for unexpected items (False Positives)
            for act_item in act_list:
                if act_item not in exp_list:
                    item_key = f"{key}[{act_item}]"
                    scores[item_key] = -1.0
                    mismatches.append(f"[FP] {item_key}: unexpected='{act_item}'")
            
            continue

        # Handle null/empty values properly
        # Check if this is a "._empty" field (indicating null in ground truth)
        # When flatten_json_for_comparison encounters a null value, it creates a field with "._empty" suffix
        # and sets it to True. This indicates the ground truth expects this field to be null/missing.
        is_empty_field = key.endswith('._empty')
        
        # both "missing" or empty → TN
        if exp is None and act is None:
            true_negatives += 1
            # Record TN explicitly as 0.0 score so downstream aggregations can sum TN from per-field rows
            scores[key] = 0.0
            continue

        # Handle null values in ground truth (._empty fields)
        if is_empty_field and exp is True:
            # Ground truth expects this field to be null/missing
            if act is None or act is True:
                # API response also has it as null/missing - this is correct
                true_negatives += 1
                scores[key] = 0.0
            else:
                # API response has a value when ground truth expects null - this is FP
                scores[key] = -1.0
                mismatches.append(f"[FP] {key}: unexpected='{act}' (expected null)")
            continue

        # FP: nothing expected, something found
        if exp is None and act is not None:
            scores[key] = -1.0  # Use -1.0 to mark as FP
            mismatches.append(f"[FP] {key}: unexpected='{act}'")
            continue

        # FN: something expected, nothing found (but not for null fields)
        if exp is not None and act is None and not is_empty_field:
            scores[key] = -2.0  # Use -2.0 to mark as FN
            mismatches.append(f"[FN] {key}: missing (expected='{exp}')")
            continue

        # both present: exact match or FP
        sim = calculate_exact_similarity(exp, act)
        scores[key] = sim
        if sim < 1.0:
            # Wrong value extracted - this is FP
            scores[key] = -1.0  # Use -1.0 to mark as FP
            mismatches.append(f"[FP] {key}: expected='{exp}' got='{act}'")

    return scores, mismatches, true_negatives


def calculate_field_metrics(all_scores: List[Dict[str, float]]) -> Dict[str, Dict[str, int]]:
    """Calculate TP/FP/FN metrics for each individual field."""
    field_metrics = {}
    
    for scores in all_scores:
        for field, score in scores.items():
            if field not in field_metrics:
                field_metrics[field] = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
            
            if score >= 0.99:  # Perfect or near-perfect match is TP
                field_metrics[field]["tp"] += 1
            elif score == -1.0:  # False Positive (wrong value or unexpected field)
                field_metrics[field]["fp"] += 1
            elif score == -2.0:  # False Negative (missing expected field)
                field_metrics[field]["fn"] += 1
            elif score > 0.0:  # Partial match is still TP
                field_metrics[field]["tp"] += 1
            elif score == 0.0:  # True Negative recorded explicitly
                field_metrics[field]["tn"] += 1
            # Note: scores for true negatives are handled separately and don't appear in individual field scores
    
    return field_metrics


def calculate_overall_metrics(all_scores: List[Dict[str, float]]) -> EvaluationMetrics:
    """Calculate overall TP/FP/FN/TN metrics from per-field scores. TN is counted where score == 0.0."""
    tp = fp = fn = tn = 0
 
    for scores in all_scores:
        for field, score in scores.items():
            if score >= 0.99:  # Perfect or near-perfect match is TP
                tp += 1
            elif score == -1.0:  # False Positive (wrong value or unexpected field)
                fp += 1
            elif score == -2.0:  # False Negative (missing expected field)
                fn += 1
            elif score > 0.0:  # Partial match is still TP
                tp += 1
            elif score == 0.0:  # True Negative recorded explicitly
                tn += 1
 
    # Calculate metrics
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1_score = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    accuracy = (tp + tn) / (tp + fp + fn + tn) if (tp + fp + fn + tn) > 0 else 0.0
 
    return EvaluationMetrics(
        true_positives=tp,
        false_positives=fp,
        false_negatives=fn,
        true_negatives=tn,
        precision=precision,
        recall=recall,
        f1_score=f1_score,
        accuracy=accuracy
    )