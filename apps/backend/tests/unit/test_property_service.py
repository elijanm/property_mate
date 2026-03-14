"""Unit tests for property service — unit code generation and template expansion."""
import pytest
from app.services.property_service import generate_unit_code, expand_templates
from app.schemas.property import UnitTemplateRequest
from app.models.property import WingConfig


# ── Unit code generation (deterministic) ─────────────────────────────────────

def test_unit_code_with_wing_numeric():
    assert generate_unit_code("A", 1, "2") == "A-0102"


def test_unit_code_with_wing_padded():
    assert generate_unit_code("B", 3, "10") == "B-0310"


def test_unit_code_without_wing():
    assert generate_unit_code(None, 2, "5") == "0205"


def test_unit_code_alpha_unit():
    assert generate_unit_code("A", 1, "B") == "A-01B"


def test_unit_code_wing_uppercased():
    assert generate_unit_code("a", 1, "1") == "A-0101"


def test_unit_code_deterministic_same_inputs():
    code1 = generate_unit_code("C", 4, "7")
    code2 = generate_unit_code("C", 4, "7")
    assert code1 == code2


# ── Template expansion ────────────────────────────────────────────────────────

def test_expand_single_template_wingless():
    template = UnitTemplateRequest(
        template_name="standard",
        floors_start=1,
        floors_end=2,
        units_per_floor=3,
    )
    units = expand_templates(wings=[], unit_templates=[template])
    assert len(units) == 6  # 2 floors × 3 units
    codes = [u["unit_code"] for u in units]
    assert "0101" in codes
    assert "0203" in codes


def test_expand_template_with_wings():
    wings = [WingConfig(name="A", floors_start=1, floors_end=3),
             WingConfig(name="B", floors_start=1, floors_end=3)]
    template = UnitTemplateRequest(
        template_name="standard",
        floors_start=1,
        floors_end=2,
        units_per_floor=2,
    )
    units = expand_templates(wings=wings, unit_templates=[template])
    # 2 wings × 2 floors × 2 units = 8
    assert len(units) == 8
    codes = [u["unit_code"] for u in units]
    assert "A-0101" in codes
    assert "B-0202" in codes


def test_expand_explicit_unit_numbers():
    template = UnitTemplateRequest(
        template_name="special",
        floors_start=3,
        floors_end=3,
        unit_numbers=["A", "B", "C"],
    )
    units = expand_templates(wings=[], unit_templates=[template])
    codes = [u["unit_code"] for u in units]
    assert codes == ["03A", "03B", "03C"]


def test_expand_deduplicates_overlapping_templates():
    template1 = UnitTemplateRequest(
        template_name="t1",
        floors_start=1,
        floors_end=1,
        units_per_floor=2,
    )
    template2 = UnitTemplateRequest(
        template_name="t2",
        floors_start=1,
        floors_end=1,
        units_per_floor=2,  # same floor+units
    )
    units = expand_templates(wings=[], unit_templates=[template1, template2])
    codes = [u["unit_code"] for u in units]
    # No duplicates
    assert len(codes) == len(set(codes))
    assert len(codes) == 2


def test_expand_template_specific_wings():
    wings = [
        WingConfig(name="A", floors_start=1, floors_end=3),
        WingConfig(name="B", floors_start=1, floors_end=3),
    ]
    template = UnitTemplateRequest(
        template_name="premium",
        wings=["A"],  # only wing A
        floors_start=1,
        floors_end=1,
        units_per_floor=2,
    )
    units = expand_templates(wings=wings, unit_templates=[template])
    assert len(units) == 2
    assert all(u["wing"] == "A" for u in units)


def test_expand_total_count_large_property():
    wings = [WingConfig(name=c, floors_start=1, floors_end=10) for c in "ABCD"]
    template = UnitTemplateRequest(
        template_name="standard",
        floors_start=1,
        floors_end=10,
        units_per_floor=20,
    )
    units = expand_templates(wings=wings, unit_templates=[template])
    assert len(units) == 4 * 10 * 20  # 800
