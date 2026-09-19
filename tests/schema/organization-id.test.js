import assert from "node:assert/strict";
import test from "node:test";
import { assertOrganizationId, isOrganizationId } from "../../src/data/schema/organization-id.js";
import { paths } from "../../src/data/schema/paths.js";

test("an organization id is lowercase letters, digits and hyphens", () => {
  for (const value of ["centera", "center-a", "center-2", "a", "1"]) {
    assert.equal(isOrganizationId(value), true, `${value} should be accepted`);
  }
});

test("uppercase, underscores and slashes are refused", () => {
  for (const value of ["Center-A", "center_a", "center/a", "center a", "", "center.a", "센터"]) {
    assert.equal(isOrganizationId(value), false, `${value} should be refused`);
    assert.throws(() => assertOrganizationId(value), /Invalid organizationId/);
  }
});

test("a non-string is refused", () => {
  for (const value of [undefined, null, 42, {}, ["center-a"]]) {
    assert.equal(isOrganizationId(value), false);
  }
});

test("orgMembership builds the same document id the rules helper builds", () => {
  assert.equal(paths.orgMembership("center-a", "user-1"), "memberships/center-a_user-1");
});

test("orgMembership refuses an organization id that would blur the document id", () => {
  assert.throws(() => paths.orgMembership("center_a", "user-1"), /Invalid organizationId/);
  assert.throws(() => paths.orgMembership("Center-A", "user-1"), /Invalid organizationId/);
  assert.throws(() => paths.orgMembership("legacy_user-1", "user-1"), /Invalid organizationId/);
  assert.throws(() => paths.orgMembership("center-a", ""), /Invalid userId/);
});
