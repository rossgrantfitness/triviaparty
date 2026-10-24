import { describe, expect, it } from "vitest";
import { ROOM_CODE_ALPHABET, decodeJoinCode, encodeJoinCode, JOIN_CODE_ALPHABET, pickLanAddress } from "@trivia/shared";
import * as site from "../../docs/join_code.js";

describe("join codes", () => {
  it("spell home addresses in 4, 5 or 6 letters and come back the same", () => {
    for (const [address, length] of [
      ["192.168.1.20", 4],
      ["192.168.0.1", 4],
      ["192.168.255.255", 4],
      ["172.16.0.5", 5],
      ["172.31.200.9", 5],
      ["10.0.0.2", 6],
      ["10.255.255.254", 6],
    ] as const) {
      const code = encodeJoinCode(address);
      expect(code).toHaveLength(length);
      expect(decodeJoinCode(code!)).toBe(address);
      expect(decodeJoinCode(code!.toLowerCase())).toBe(address);
    }
  });

  it("gives every 192.168 address its own code", () => {
    const seen = new Set<string>();
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b += 7) seen.add(encodeJoinCode(`192.168.${a}.${b}`)!);
    expect(seen.size).toBe(256 * Math.ceil(256 / 7));
  });

  it("uses only room-code letters", () => {
    expect(JOIN_CODE_ALPHABET).toBe(ROOM_CODE_ALPHABET);
    expect(encodeJoinCode("192.168.1.20")).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`));
  });

  it("refuses public addresses and nonsense", () => {
    expect(encodeJoinCode("8.8.8.8")).toBeNull();
    expect(encodeJoinCode("172.32.0.1")).toBeNull();
    expect(encodeJoinCode("not an address")).toBeNull();
    expect(decodeJoinCode("AB")).toBeNull();
    expect(decodeJoinCode("AB1D")).toBeNull();
  });

  it("most random 4-letter codes don't point anywhere", () => {
    let pointing = 0;
    for (const code of ["ZZZZ", "ABCD", "QWER", "MNBV", "XYZW", "HJKL"]) if (decodeJoinCode(code)) pointing++;
    expect(pointing).toBeLessThan(6);
  });

  it("picks the home Wi-Fi address over virtual adapters", () => {
    expect(pickLanAddress(["172.17.0.1", "10.0.0.8", "192.168.1.20"])).toBe("192.168.1.20");
    expect(pickLanAddress(["172.17.0.1", "10.0.0.8"])).toBe("10.0.0.8");
    expect(pickLanAddress(["8.8.8.8"])).toBeNull();
  });

  it("the website's copy decodes the same way", () => {
    for (const address of ["192.168.1.20", "172.20.3.4", "10.1.2.3"]) {
      expect(site.decodeJoinCode(encodeJoinCode(address)!)).toBe(address);
    }
  });
});
