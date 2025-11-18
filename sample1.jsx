import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Simple Computer Simulator (single-file React component)
// - CPU, RAM, Bus, Memory
// - Small instruction set (LOAD, STORE, ADD, SUB, JMP, JZ, OUT, HALT)
// - Visual animation using framer-motion and TailwindCSS
// Drop this file into a React app that supports Tailwind + framer-motion (or paste into CodeSandbox)

// --- Tiny ISA ---
const OPCODES = {
  NOP: 0,
  LOAD: 1, // LOAD reg, addr
  STORE: 2, // STORE reg, addr
  ADD: 3, // ADD reg, addr
  SUB: 4,
  JMP: 5, // JMP addr
  JZ: 6, // JZ addr (jump if zero flag)
  OUT: 7, // OUT reg
  HALT: 255,
};

// --- Memory (RAM) ---
class RAM {
  constructor(size = 64) {
    this.size = size;
    this.data = new Array(size).fill(0);
  }
  read(addr) {
    addr = this._wrap(addr);
    return this.data[addr];
  }
  write(addr, value) {
    addr = this._wrap(addr);
    this.data[addr] = value & 0xff;
  }
  _wrap(addr) {
    return ((addr % this.size) + this.size) % this.size;
  }
}

// --- Bus ---
class Bus {
  constructor() {
    this.lines = { addr: null, data: null, control: null };
    this.listeners = [];
  }
  send(packet) {
    this.lines = { ...this.lines, ...packet };
    this._notify();
  }
  clear() {
    this.lines = { addr: null, data: null, control: null };
    this._notify();
  }
  onChange(cb) {
    this.listeners.push(cb);
  }
  _notify() {
    this.listeners.forEach((cb) => cb(this.lines));
  }
}

// --- Simple CPU ---
class CPU {
  constructor({ ram, bus }) {
    this.ram = ram;
    this.bus = bus;

    // registers
    this.PC = 0; // program counter
    this.ACC = 0; // accumulator
    this.IR = 0; // instruction register
    this.flags = { zero: false };
    this.halted = false;

    // hooks for UI updates
    this.onStep = () => {};
  }

  loadProgram(program, start = 0) {
    for (let i = 0; i < program.length; i++) {
      this.ram.write(start + i, program[i]);
    }
    this.PC = start;
  }

  step() {
    if (this.halted) return { type: "HALT" };

    // fetch
    this.bus.send({ addr: this.PC, control: "FETCH" });
    const instr = this.ram.read(this.PC);
    this.IR = instr;
    this.PC += 1;

    // decode + execute
    switch (instr) {
      case OPCODES.NOP:
        this._tick("NOP");
        break;
      case OPCODES.LOAD: {
        const addr = this.ram.read(this.PC++);
        this.bus.send({ addr, control: "READ" });
        const val = this.ram.read(addr);
        this.ACC = val;
        this.flags.zero = this.ACC === 0;
        this._tick(`LOAD ${addr}`);
        break;
      }
      case OPCODES.STORE: {
        const addr = this.ram.read(this.PC++);
        this.bus.send({ addr, data: this.ACC, control: "WRITE" });
        this.ram.write(addr, this.ACC);
        this._tick(`STORE ${addr}`);
        break;
      }
      case OPCODES.ADD: {
        const addr = this.ram.read(this.PC++);
        this.bus.send({ addr, control: "READ" });
        const val = this.ram.read(addr);
        this.ACC = (this.ACC + val) & 0xff;
        this.flags.zero = this.ACC === 0;
        this._tick(`ADD ${addr}`);
        break;
      }
      case OPCODES.SUB: {
        const addr = this.ram.read(this.PC++);
        this.bus.send({ addr, control: "READ" });
        const val = this.ram.read(addr);
        this.ACC = (this.ACC - val) & 0xff;
        this.flags.zero = this.ACC === 0;
        this._tick(`SUB ${addr}`);
        break;
      }
      case OPCODES.JMP: {
        const addr = this.ram.read(this.PC++);
        this.PC = addr;
        this._tick(`JMP ${addr}`);
        break;
      }
      case OPCODES.JZ: {
        const addr = this.ram.read(this.PC++);
        if (this.flags.zero) {
          this.PC = addr;
          this._tick(`JZ (taken) ${addr}`);
        } else {
          this._tick(`JZ (not taken) ${addr}`);
        }
        break;
      }
      case OPCODES.OUT: {
        this._tick(`OUT ${this.ACC}`);
        break;
      }
      case OPCODES.HALT: {
        this.halted = true;
        this._tick("HALT");
        break;
      }
      default: {
        this._tick(`DATA ${instr}`);
        break;
      }
    }

    // clear bus after action
    setTimeout(() => this.bus.clear(), 300);

    return { pc: this.PC, acc: this.ACC, ir: this.IR, flags: { ...this.flags } };
  }

  _tick(action) {
    // notify UI
    if (this.onStep) this.onStep({ action, pc: this.PC, acc: this.ACC, ir: this.IR, flags: { ...this.flags } });
  }

  reset() {
    this.PC = 0;
    this.ACC = 0;
    this.IR = 0;
    this.flags = { zero: false };
    this.halted = false;
  }
}

// --- Helper: sample program ---
// This program: stores value 7 at mem[10], stores 3 at mem[11], adds them into ACC and OUT
const sampleProgram = [
  OPCODES.LOAD, 10, // ACC = mem[10]
  OPCODES.ADD, 11, // ACC += mem[11]
  OPCODES.OUT, // OUT ACC
  OPCODES.STORE, 12, // STORE ACC -> mem[12]
  OPCODES.HALT,
  // data
];

// data region (addresses 10..)
const sampleData = { 10: 7, 11: 3 };

// --- React Component ---
export default function SimpleComputerSimulator() {
  const [ram] = useState(() => new RAM(64));
  const [bus] = useState(() => new Bus());
  const [cpu] = useState(() => new CPU({ ram: ram, bus: bus }));

  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(600); // ms per step
  const [log, setLog] = useState([]);
  const [tickCount, setTickCount] = useState(0);
  const intervalRef = useRef(null);

  // UI preview of bus lines
  const [busState, setBusState] = useState(bus.lines);
  useEffect(() => bus.onChange(setBusState), [bus]);

  // wire CPU step notifier
  useEffect(() => {
    cpu.onStep = (s) => {
      setLog((l) => [{ t: Date.now(), ...s }, ...l].slice(0, 200));
      setTickCount((t) => t + 1);
    };
  }, [cpu]);

  // load program & data into RAM on mount
  useEffect(() => {
    cpu.reset();
    cpu.loadProgram(sampleProgram, 0);
    Object.keys(sampleData).forEach((k) => ram.write(parseInt(k), sampleData[k]));
    setLog([{ t: Date.now(), action: "PROGRAM LOADED" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        const state = cpu.step();
        // if halted, stop
        if (cpu.halted) setRunning(false);
      }, speed);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, speed, cpu]);

  function stepOnce() {
    const state = cpu.step();
    if (cpu.halted) setRunning(false);
  }

  function resetAll() {
    cpu.reset();
    ram.data.fill(0);
    cpu.loadProgram(sampleProgram, 0);
    Object.keys(sampleData).forEach((k) => ram.write(parseInt(k), sampleData[k]));
    setLog([{ t: Date.now(), action: "RESET" }]);
    setTickCount(0);
    bus.clear();
  }

  function quickAssemble(assemblies) {
    // small assembler: lines like "LOAD 10" or "DATA 20 5"
    const mapping = Object.fromEntries(Object.entries(OPCODES).map(([k, v]) => [k, v]));
    const out = [];
    const data = {};
    assemblies.forEach((ln) => {
      const parts = ln.trim().split(/\s+/);
      if (!parts[0]) return;
      const op = parts[0].toUpperCase();
      if (op === "DATA") {
        // DATA addr value
        const addr = parseInt(parts[1]);
        const val = parseInt(parts[2]);
        data[addr] = val;
      } else if (mapping[op] !== undefined) {
        out.push(mapping[op]);
        if (parts[1] !== undefined) out.push(parseInt(parts[1]));
      }
    });

    return { prog: out, data };
  }

  // Visual helpers
  function renderRAMCells() {
    return ram.data.slice(0, 32).map((v, i) => (
      <div key={i} className="p-1 text-xs border rounded bg-white/80 flex flex-col items-center">
        <div className="text-[10px] text-gray-500">{i}</div>
        <div className="font-mono text-sm">{v}</div>
      </div>
    ));
  }

  return (
    <div className="p-6 min-h-screen bg-gradient-to-br from-slate-900 to-gray-800 text-white">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Simple Computer Simulator</h1>
        <div className="flex gap-4">
          <div className="w-2/3 space-y-4">
            <div className="bg-white/5 p-4 rounded shadow">
              <div className="flex items-center gap-4">
                <button
                  className={`px-3 py-1 rounded ${running ? "bg-rose-500" : "bg-green-500"}`}
                  onClick={() => setRunning((r) => !r)}
                >
                  {running ? "Pause" : "Run"}
                </button>
                <button className="px-3 py-1 rounded bg-blue-600" onClick={stepOnce}>
                  Step
                </button>
                <button className="px-3 py-1 rounded bg-yellow-600" onClick={resetAll}>
                  Reset
                </button>
                <div className="flex items-center gap-2 ml-4">
                  <div>Speed</div>
                  <input
                    type="range"
                    min={100}
                    max={1500}
                    value={speed}
                    onChange={(e) => setSpeed(parseInt(e.target.value))}
                  />
                  <div className="text-sm w-12">{speed}ms</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-4">
                <div className="p-3 bg-white/6 rounded">
                  <div className="font-semibold">CPU</div>
                  <div className="mt-2 text-sm">
                    <div>PC: {cpu.PC}</div>
                    <div>ACC: {cpu.ACC}</div>
                    <div>IR: {cpu.IR}</div>
                    <div>Zero: {cpu.flags.zero ? "1" : "0"}</div>
                    <div>Halted: {cpu.halted ? "YES" : "NO"}</div>
                  </div>
                </div>
                <div className="p-3 bg-white/6 rounded">
                  <div className="font-semibold">Bus</div>
                  <div className="mt-2 text-sm">
                    <div>Addr: {String(busState.addr ?? "—")}</div>
                    <div>Data: {String(busState.data ?? "—")}</div>
                    <div>Control: {String(busState.control ?? "—")}</div>
                  </div>
                </div>
                <div className="p-3 bg-white/6 rounded">
                  <div className="font-semibold">Logs</div>
                  <div className="mt-2 text-xs h-24 overflow-auto bg-black/30 p-2 rounded">
                    {log.map((l, idx) => (
                      <div key={idx} className="mb-1">
                        <span className="text-gray-400">[{new Date(l.t).toLocaleTimeString()}]</span>{" "}
                        <span className="font-mono text-sm">{l.action ?? JSON.stringify(l)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Visual animation: CPU -> Bus -> RAM */}
              <div className="mt-6 p-4 rounded bg-white/3">
                <div className="grid grid-cols-3 items-center gap-4">
                  <div className="flex flex-col items-center gap-2">
                    <div className="p-3 rounded bg-white/5 w-36 text-center">CPU</div>
                    <div className="text-xs mt-1">ACC: {cpu.ACC}</div>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <div className="p-3 rounded bg-white/5 w-48 text-center">Bus</div>
                    <motion.div
                      key={busState.addr + "," + busState.data}
                      initial={{ y: -8, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.4 }}
                      className="text-xs mt-1 font-mono"
                    >
                      {busState.control ? `${busState.control} @${String(busState.addr ?? "—")} = ${String(busState.data ?? "—")}` : "idle"}
                    </motion.div>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <div className="p-3 rounded bg-white/5 w-40 text-center">RAM (0-31)</div>
                    <div className="text-xs mt-1">tick: {tickCount}</div>
                  </div>
                </div>

                {/* Animated bus line: show a bubble moving when bus has data */}
                <div className="relative h-6 mt-6">
                  <AnimatePresence>
                    {(busState.control && (busState.data !== null || busState.addr !== null)) && (
                      <motion.div
                        layoutId="bubble"
                        initial={{ left: 0, opacity: 0.6 }}
                        animate={{ left: "62%", opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.6 }}
                        className="absolute top-0 p-2 rounded-full bg-indigo-500/80 text-sm"
                        style={{ transform: "translateX(-50%)" }}
                      >
                        {busState.control}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            <div className="bg-white/5 p-4 rounded">
              <div className="font-semibold mb-2">RAM (0–31) — Click a cell to change value</div>
              <div className="grid grid-cols-8 gap-2">{renderRAMCells()}</div>
            </div>
          </div>

          <div className="w-1/3 space-y-4">
            <div className="bg-white/5 p-4 rounded">
              <div className="font-semibold">Assembler</div>
              <div className="mt-2 text-sm">
                <pre className="text-xs bg-black/10 p-2 rounded">{
`Example:
LOAD 10
ADD 11
OUT
STORE 12
HALT
DATA 10 7
DATA 11 3`}
                </pre>
                <AssemblerBox
                  onAssemble={(text) => {
                    const lines = text.split(/\n/).map((r) => r.trim()).filter(Boolean);
                    const { prog, data } = quickAssemble(lines);
                    // write into ram starting at 0
                    ram.data.fill(0);
                    for (let i = 0; i < prog.length; i++) ram.write(i, prog[i]);
                    Object.entries(data).forEach(([k, v]) => ram.write(parseInt(k), v));
                    cpu.reset();
                    cpu.loadProgram(prog, 0);
                    setLog((l) => [{ t: Date.now(), action: "ASSEMBLED" }, ...l].slice(0, 200));
                  }}
                />
              </div>
            </div>

            <div className="bg-white/5 p-4 rounded">
              <div className="font-semibold">Memory dump (0–63)</div>
              <div className="text-xs mt-2 max-h-64 overflow-auto bg-black/10 p-2 rounded">
                <table className="w-full table-auto text-left text-sm">
                  <thead className="text-[11px] text-gray-400">
                    <tr>
                      <th>Addr</th>
                      <th>Val</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ram.data.map((v, i) => (
                      <tr key={i} className="even:bg-white/2">
                        <td className="pr-3">{i}</td>
                        <td className="font-mono">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white/5 p-4 rounded">
              <div className="font-semibold">Explanation</div>
              <div className="mt-2 text-sm text-gray-200">
                This tiny simulated computer shows how a CPU fetches instructions from RAM via a shared bus, decodes
                them and performs simple operations on an accumulator. Use Step to advance one clock; Run will repeatedly
                step at the chosen speed.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Small interactive assembler box component ---
function AssemblerBox({ onAssemble }) {
  const [text, setText] = useState(`LOAD 10\nADD 11\nOUT\nSTORE 12\nHALT\nDATA 10 7\nDATA 11 3`);
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="w-full p-2 rounded bg-black/10 text-sm" />
      <div className="flex gap-2 mt-2">
        <button className="px-3 py-1 bg-green-600 rounded" onClick={() => onAssemble(text)}>
          Assemble & Load
        </button>
        <button
          className="px-3 py-1 bg-blue-600 rounded"
          onClick={() => {
            setText(`LOAD 10\nADD 11\nOUT\nSTORE 12\nHALT\nDATA 10 7\nDATA 11 3`);
          }}
        >
          Reset Example
        </button>
      </div>
    </div>
  );
}
