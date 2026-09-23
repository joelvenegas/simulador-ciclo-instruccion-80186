// instruction-docs.js — Glosario de instrucciones y directivas soportadas
// por el ensamblador, para el atajo de ayuda contextual (F1) y la
// pestaña "Glosario" del panel lateral.
(function (global) {
  'use strict';

  // Clave = mnemónico canónico tal como aparece en js/isa.js / js/assembler.js.
  const INSTRUCTION_DOCS = {
    // ---- Movimiento de datos ----
    MOV:  { syntax: 'MOV dest, src', desc: 'Copia el valor de src en dest. No modifica los flags.' },
    PUSH: { syntax: 'PUSH src', desc: 'Decrementa SP en 2 y guarda el valor de 16 bits en la pila (SS:SP).' },
    POP:  { syntax: 'POP dest', desc: 'Extrae 2 bytes de la pila (SS:SP) hacia dest e incrementa SP en 2.' },
    PUSHA:{ syntax: 'PUSHA', desc: 'Apila los 8 registros generales en este orden: AX, CX, DX, BX, SP (valor original), BP, SI, DI.' },
    POPA: { syntax: 'POPA', desc: 'Restaura los 8 registros generales apilados por PUSHA, en orden inverso (el valor apilado de SP se descarta).' },

    // ---- Aritmética / lógica ----
    ADD: { syntax: 'ADD dest, src', desc: 'dest = dest + src. Actualiza CF, OF, SF, ZF, AF y PF.' },
    SUB: { syntax: 'SUB dest, src', desc: 'dest = dest - src. Actualiza CF, OF, SF, ZF, AF y PF.' },
    CMP: { syntax: 'CMP dest, src', desc: 'Calcula dest - src solo para actualizar los flags (CF, OF, SF, ZF, AF, PF); no modifica dest. Se usa antes de un salto condicional.' },
    AND: { syntax: 'AND dest, src', desc: 'dest = dest AND src (bit a bit). Limpia CF y OF; actualiza SF, ZF y PF.' },
    OR:  { syntax: 'OR dest, src', desc: 'dest = dest OR src (bit a bit). Limpia CF y OF; actualiza SF, ZF y PF.' },
    XOR: { syntax: 'XOR dest, src', desc: 'dest = dest XOR src (bit a bit). Limpia CF y OF; actualiza SF, ZF y PF. "XOR reg, reg" es la forma habitual de poner un registro en 0.' },
    INC: { syntax: 'INC operando', desc: 'Suma 1 al operando. Actualiza OF, SF, ZF, AF y PF; no modifica CF.' },
    DEC: { syntax: 'DEC operando', desc: 'Resta 1 al operando. Actualiza OF, SF, ZF, AF y PF; no modifica CF.' },

    MUL:  { syntax: 'MUL src', desc: 'Multiplicación sin signo: AX = AL × src (byte) o DX:AX = AX × src (word).' },
    IMUL: { syntax: 'IMUL src', desc: 'Multiplicación con signo: igual que MUL pero interpretando los operandos como valores con signo.' },
    DIV:  { syntax: 'DIV src', desc: 'División sin signo: AL = AX ÷ src y AH = resto (byte), o AX = DX:AX ÷ src y DX = resto (word).' },
    IDIV: { syntax: 'IDIV src', desc: 'División con signo: igual que DIV pero interpretando los operandos como valores con signo.' },
    CBW:  { syntax: 'CBW', desc: 'Extiende el signo de AL a AH (convierte un byte con signo en una word).' },
    CWD:  { syntax: 'CWD', desc: 'Extiende el signo de AX a DX (deja el par DX:AX listo para DIV/IDIV de word).' },

    // ---- Desplazamientos y rotaciones ----
    SHL: { syntax: 'SHL operando, cuenta', desc: 'Desplaza los bits a la izquierda; entra 0 por la derecha y el último bit desplazado queda en CF. (SAL es un alias de SHL.)' },
    SHR: { syntax: 'SHR operando, cuenta', desc: 'Desplaza los bits a la derecha sin signo; entra 0 por la izquierda y el último bit desplazado queda en CF.' },
    SAR: { syntax: 'SAR operando, cuenta', desc: 'Desplaza los bits a la derecha conservando el bit de signo (división con signo entre potencias de 2); el último bit desplazado queda en CF.' },
    ROL: { syntax: 'ROL operando, cuenta', desc: 'Rota los bits a la izquierda: el bit que sale por la izquierda vuelve a entrar por la derecha y también se copia en CF.' },
    ROR: { syntax: 'ROR operando, cuenta', desc: 'Rota los bits a la derecha: el bit que sale por la derecha vuelve a entrar por la izquierda y también se copia en CF.' },
    RCL: { syntax: 'RCL operando, cuenta', desc: 'Rota a la izquierda incluyendo CF como un bit más del anillo de rotación.' },
    RCR: { syntax: 'RCR operando, cuenta', desc: 'Rota a la derecha incluyendo CF como un bit más del anillo de rotación.' },

    // ---- Control de flujo ----
    JMP:  { syntax: 'JMP destino', desc: 'Salto incondicional: IP = destino.' },
    LOOP: { syntax: 'LOOP etiqueta', desc: 'Decrementa CX; si CX ≠ 0, salta a etiqueta. Se usa para bucles con contador en CX.' },
    LOOPE:  { syntax: 'LOOPE/LOOPZ etiqueta', desc: 'Decrementa CX; salta a etiqueta si CX ≠ 0 y ZF = 1 (repite mientras dé "igual").' },
    LOOPNE: { syntax: 'LOOPNE/LOOPNZ etiqueta', desc: 'Decrementa CX; salta a etiqueta si CX ≠ 0 y ZF = 0 (repite mientras dé "distinto").' },
    JCXZ: { syntax: 'JCXZ etiqueta', desc: 'Salta a etiqueta si CX = 0. No decrementa CX (a diferencia de LOOP).' },
    CALL: { syntax: 'CALL destino', desc: 'Apila la dirección de retorno (IP siguiente) y salta a destino (llamada a subrutina).' },
    RET:  { syntax: 'RET [n]', desc: 'Extrae la dirección de retorno de la pila y salta a ella. Con el operando inmediato n, además libera n bytes extra de la pila (parámetros).' },

    // ---- Saltos condicionales (Jcc) ----
    JO:  { syntax: 'JO etiqueta', desc: 'Salta si OF = 1 (hubo desbordamiento con signo).' },
    JNO: { syntax: 'JNO etiqueta', desc: 'Salta si OF = 0.' },
    JB:  { syntax: 'JB/JC/JNAE etiqueta', desc: 'Salta si CF = 1. Comparación sin signo: "menor que".' },
    JAE: { syntax: 'JAE/JNB/JNC etiqueta', desc: 'Salta si CF = 0. Comparación sin signo: "mayor o igual".' },
    JE:  { syntax: 'JE/JZ etiqueta', desc: 'Salta si ZF = 1 (los operandos comparados son iguales, o el resultado dio cero).' },
    JNE: { syntax: 'JNE/JNZ etiqueta', desc: 'Salta si ZF = 0 (los operandos comparados son distintos, o el resultado no dio cero).' },
    JBE: { syntax: 'JBE/JNA etiqueta', desc: 'Salta si CF = 1 o ZF = 1. Comparación sin signo: "menor o igual".' },
    JA:  { syntax: 'JA/JNBE etiqueta', desc: 'Salta si CF = 0 y ZF = 0. Comparación sin signo: "mayor que".' },
    JS:  { syntax: 'JS etiqueta', desc: 'Salta si SF = 1 (resultado negativo).' },
    JNS: { syntax: 'JNS etiqueta', desc: 'Salta si SF = 0 (resultado positivo o cero).' },
    JP:  { syntax: 'JP/JPE etiqueta', desc: 'Salta si PF = 1 (paridad par en el byte bajo del resultado).' },
    JNP: { syntax: 'JNP/JPO etiqueta', desc: 'Salta si PF = 0 (paridad impar en el byte bajo del resultado).' },
    JL:  { syntax: 'JL/JNGE etiqueta', desc: 'Salta si SF ≠ OF. Comparación con signo: "menor que".' },
    JGE: { syntax: 'JGE/JNL etiqueta', desc: 'Salta si SF = OF. Comparación con signo: "mayor o igual".' },
    JLE: { syntax: 'JLE/JNG etiqueta', desc: 'Salta si ZF = 1 o SF ≠ OF. Comparación con signo: "menor o igual".' },
    JG:  { syntax: 'JG/JNLE etiqueta', desc: 'Salta si ZF = 0 y SF = OF. Comparación con signo: "mayor que".' },

    // ---- Instrucciones de cadena ----
    MOVSB: { syntax: 'MOVSB', desc: 'Copia el byte en DS:SI hacia ES:DI; luego avanza (o retrocede, según DF) SI y DI en 1.' },
    MOVSW: { syntax: 'MOVSW', desc: 'Copia la palabra (2 bytes) en DS:SI hacia ES:DI; luego avanza SI y DI en 2 según DF.' },
    LODSB: { syntax: 'LODSB', desc: 'Carga AL desde DS:SI; luego avanza SI en 1 según DF.' },
    LODSW: { syntax: 'LODSW', desc: 'Carga AX desde DS:SI; luego avanza SI en 2 según DF.' },
    STOSB: { syntax: 'STOSB', desc: 'Guarda AL en ES:DI; luego avanza DI en 1 según DF.' },
    STOSW: { syntax: 'STOSW', desc: 'Guarda AX en ES:DI; luego avanza DI en 2 según DF.' },
    CMPSB: { syntax: 'CMPSB', desc: 'Compara el byte en DS:SI con el de ES:DI (actualiza flags como CMP); luego avanza SI y DI en 1.' },
    CMPSW: { syntax: 'CMPSW', desc: 'Compara la palabra en DS:SI con la de ES:DI (actualiza flags como CMP); luego avanza SI y DI en 2.' },
    SCASB: { syntax: 'SCASB', desc: 'Compara AL con el byte en ES:DI (actualiza flags como CMP); luego avanza DI en 1.' },
    SCASW: { syntax: 'SCASW', desc: 'Compara AX con la palabra en ES:DI (actualiza flags como CMP); luego avanza DI en 2.' },

    REP:    { syntax: 'REP instrucción-de-cadena', desc: 'Prefijo que repite la instrucción de cadena siguiente (MOVSx/STOSx/LODSx) mientras CX ≠ 0, decrementando CX en cada repetición.' },
    REPE:   { syntax: 'REPE/REPZ instrucción-de-cadena', desc: 'Prefijo que repite CMPSx/SCASx mientras CX ≠ 0 y ZF = 1 (mientras siga dando "igual").' },
    REPNE:  { syntax: 'REPNE/REPNZ instrucción-de-cadena', desc: 'Prefijo que repite CMPSx/SCASx mientras CX ≠ 0 y ZF = 0 (mientras siga dando "distinto").' },

    // ---- Marco de pila ----
    ENTER: { syntax: 'ENTER tamaño, nivel', desc: 'Crea un marco de pila para una subrutina: apila BP, hace BP = SP y reserva "tamaño" bytes para variables locales.' },
    LEAVE: { syntax: 'LEAVE', desc: 'Deshace el marco creado por ENTER: SP = BP, y luego POP BP.' },

    // ---- Banderas de control ----
    CLD: { syntax: 'CLD', desc: 'Pone DF = 0: las instrucciones de cadena (MOVSx, STOSx, etc.) avanzan SI/DI.' },
    STD: { syntax: 'STD', desc: 'Pone DF = 1: las instrucciones de cadena (MOVSx, STOSx, etc.) retroceden SI/DI.' },
    CLI: { syntax: 'CLI', desc: 'Pone IF = 0: deshabilita las interrupciones enmascarables.' },
    STI: { syntax: 'STI', desc: 'Pone IF = 1: habilita las interrupciones enmascarables.' },

    // ---- Varias ----
    INT: { syntax: 'INT n', desc: 'Interrupción de software: apila FLAGS/CS/IP y salta a la rutina n. Con INT 21h, AH elige la función del DOS (por ej. AH=09h imprime en DS:DX un string terminado en \'$\'; AH=4Ch termina el programa).' },
    HLT: { syntax: 'HLT', desc: 'Detiene la CPU. En este simulador marca el fin de la ejecución del programa.' },
    NOP: { syntax: 'NOP', desc: 'No hace nada; solo ocupa un ciclo de instrucción (útil para alinear código o como marcador).' },

    // ---- Directivas del ensamblador (no generan opcodes) ----
    ORG: { syntax: 'ORG dirección', desc: 'Directiva: fija la dirección (offset) donde se ubicará el código/los datos que siguen.' },
    DB:  { syntax: 'etiqueta DB valor, valor, ...', desc: 'Directiva: define uno o más bytes (1 byte cada uno) en memoria, opcionalmente con una etiqueta.' },
    DW:  { syntax: 'etiqueta DW valor, valor, ...', desc: 'Directiva: define una o más palabras (2 bytes cada una) en memoria, opcionalmente con una etiqueta.' }
  };

  // Mnemónicos que son solo alias de otro ya documentado arriba.
  const INSTRUCTION_ALIASES = {
    SAL: 'SHL',
    LOOPZ: 'LOOPE', LOOPNZ: 'LOOPNE',
    REPZ: 'REPE', REPNZ: 'REPNE',
    JC: 'JB', JNAE: 'JB',
    JNB: 'JAE', JNC: 'JAE',
    JZ: 'JE', JNZ: 'JNE',
    JNA: 'JBE', JNBE: 'JA',
    JPE: 'JP', JPO: 'JNP',
    JNGE: 'JL', JNL: 'JGE',
    JNG: 'JLE', JNLE: 'JG'
  };

  function lookupInstructionDoc(mnemonic) {
    if (!mnemonic) return null;
    const key = mnemonic.toUpperCase();
    const canon = INSTRUCTION_ALIASES[key] || key;
    const doc = INSTRUCTION_DOCS[canon];
    return doc ? { mnemonic: canon, syntax: doc.syntax, desc: doc.desc } : null;
  }

  const api = { INSTRUCTION_DOCS, INSTRUCTION_ALIASES, lookupInstructionDoc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(global, api);
})(typeof window !== 'undefined' ? window : globalThis);
