import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const path=fileURLToPath(new URL("../../scripts/verify-encrypted-backup.sh",import.meta.url));
const source=readFileSync(path,"utf8");

describe("operator-run encrypted backup verification",()=>{
 it("has valid bash syntax without requiring credentials or live database access",()=>{
  const result=spawnSync("bash",["-n",path],{encoding:"utf8"});
  expect(result.status,result.stderr).toBe(0);
 });
 it("decrypts only to the archive checker, with no database writes",()=>{
  expect(source).toContain('age --decrypt --identity "$AGE_IDENTITY_FILE" "$archive" | pg_restore --list');
  expect(source).not.toMatch(/\b(pg_restore\s+--dbname|psql\s+|dropdb\s+|createdb\s+|pg_dump\s+)/);
  expect(source).toContain("This is NOT a full recovery test.");
 });
});