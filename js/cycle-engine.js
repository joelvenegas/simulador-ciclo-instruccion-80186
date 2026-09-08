// cycle-engine.js — Orquesta el ciclo de instrucción como una máquina de
// estados de 4 etapas: FETCH -> DECODE -> EXECUTE -> WRITEBACK. Emite un
// evento por etapa para que ui.js pueda animar el diagrama de la CPU.
// No depende del DOM: es puro JS testeable desde Node.
(function (global) {
  'use strict';
  const DECODER = (typeof module !== 'undefined' && module.exports) ? require('./decoder.js') : global.DECODER;
  const EXECUTOR = (typeof module !== 'undefined' && module.exports) ? require('./executor.js') : global.EXECUTOR;

  class CycleEngine {
    constructor(cpu) {
      this.cpu = cpu;
      this.listeners = [];
    }

    on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; }
    emit(event) { this.listeners.forEach(fn => fn(event)); }

    // Ejecuta las 4 etapas de UNA instrucción. Devuelve false si la CPU ya
    // estaba detenida (HLT, INT 21h/4Ch, o una excepción de ejecución).
    stepInstruction() {
      const cpu = this.cpu;
      if (cpu.halted) { this.emit({ type: 'halted', cpu }); return false; }

      // --- FETCH --- (lee los bytes de CS:IP y avanza IP de inmediato,
      // tal como hace el 8086 real antes de ejecutar la instrucción)
      const instr = DECODER.decode(cpu);
      const ipBefore = cpu.reg.IP;
      cpu.reg.IP = (ipBefore + instr.length) & 0xFFFF;
      this.emit({ type: 'stage', stage: 'fetch', instr, ipBefore, cpu });

      // --- DECODE --- (sólo interpretación/exhibición; no cambia estado)
      this.emit({ type: 'stage', stage: 'decode', instr, cpu });

      // --- EXECUTE --- (calcula micro-ops leyendo el estado actual)
      const result = EXECUTOR.execute(cpu, instr);
      this.emit({ type: 'stage', stage: 'execute', instr, result, cpu });

      // --- WRITEBACK --- (aplica los micro-ops sobre la CPU)
      result.microOps.forEach(op => cpu.applyMicroOp(op));
      cpu.cycles++;
      this.emit({ type: 'stage', stage: 'writeback', instr, result, cpu });

      this.emit({ type: 'instructionComplete', instr, result, cpu });
      if (cpu.halted) this.emit({ type: 'halted', cpu });
      return true;
    }

    reset(image, orgAddress) {
      this.cpu.reset();
      if (image) this.cpu.loadProgram(image, orgAddress || 0);
      this.emit({ type: 'reset', cpu: this.cpu });
    }
  }

  const CYCLE_ENGINE_NS = { CycleEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = CYCLE_ENGINE_NS;
  else global.CYCLE_ENGINE_NS = CYCLE_ENGINE_NS;
})(typeof window !== 'undefined' ? window : globalThis);
