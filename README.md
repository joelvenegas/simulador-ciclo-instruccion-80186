# Simulador del ciclo de instrucción — Intel 80186 (modo real)

Herramienta educativa, 100% HTML/CSS/JS vanilla (sin dependencias, sin
build, sin servidor) para entender **cómo funciona el ciclo de
instrucción** (Fetch → Decode → Execute → Writeback) en **modo real**
usando un subconjunto real del ensamblador Intel 8086/80186.

No es un simple intérprete: el "ensamblador" genera **bytes de máquina
reales** (los mismos opcodes que generaría un ensamblador de verdad) y
el "decodificador" los vuelve a leer byte a byte desde memoria, tal
como lo haría la CPU. Eso permite ver de verdad qué significa que una
instrucción ocupe 2, 3 o 4 bytes, cómo el `IP` avanza exactamente esa
cantidad, y cómo `CS:IP` se traduce a una dirección física de memoria.

## Cómo usarlo

Abrí [`index.html`](index.html) directo en el navegador (doble click).
No hace falta instalar nada ni levantar un servidor.

1. Elegí un ejemplo del menú desplegable, o escribí tu propio código en
   el editor.
2. Presioná **▶ Ensamblar y ejecutar** (o `Ctrl+Enter` con el foco en
   el editor).
3. Usá **⏭ Paso** para avanzar una instrucción a la vez y ver cómo se
   ilumina cada etapa del ciclo en el diagrama, o **▶ Run** para
   ejecutar continuamente (con **⏸ Pausa** para detener).
4. El panel derecho tiene tres pestañas: el **listado** del programa
   ensamblado (dirección + bytes + instrucción, con la línea actual
   resaltada), la **pila** (alrededor de `SS:SP`) y la **consola**
   (salida de las interrupciones simuladas).

## El diagrama de la CPU

- **Memoria**: hexdump alrededor de `CS:IP`, con los bytes de la
  instrucción actual resaltados durante el Fetch.
- **IR (registro de instrucción)**: los bytes ya leídos de memoria.
- **Decodificador**: la instrucción interpretada (mnemónico + operandos).
- **ALU**: qué micro-operaciones calculó la etapa Execute (todavía sin
  aplicar al estado de la CPU).
- **Registros / Segmentos / Flags**: el estado de la CPU. Los
  registros y flags que cambiaron en el último paso quedan resaltados.
  El bloque de segmentos muestra explícitamente el cálculo de
  **dirección física = (CS × 16) + IP** (y lo mismo aplica a cualquier
  acceso a memoria vía DS/ES/SS), que es la esencia de cómo direcciona
  memoria el modo real.
- **Pila**: la ventana alrededor de `SS:SP` en la pestaña "Pila".

Cada instrucción se anima en 4 pasos (Fetch → Decode → Execute →
Writeback); la velocidad se controla con el slider "Velocidad de
animación".

## Sintaxis soportada

Estilo Intel (similar a MASM/TASM simplificado):

```asm
; comentarios con punto y coma
etiqueta:              ; las etiquetas de código llevan ":"
  mov ax, 5            ; registro, inmediato
  mov bx, ax            ; registro, registro
  add ax, [bx+4]        ; registro, memoria (direccionamiento indexado)
  mov word [bx], 10     ; memoria, inmediato -> requiere BYTE/WORD explícito
  jmp etiqueta

mensaje db 'Hola$'      ; una etiqueta de datos puede omitir los ":"
                        ; cuando va seguida de DB/DW
buffer  dw 0, 0, 0
CONSTANTE EQU 10        ; constante numérica (sustitución de texto)
```

- **Números**: decimal (`10`), hexadecimal (`0x0A` o `0Ah`), binario
  (`1010b`), o un carácter entre comillas (`'A'`).
- **Registros de 16 bits**: `AX BX CX DX SI DI BP SP`.
- **Registros de 8 bits**: `AL AH BL BH CL CH DL DH`.
- **Segmentos**: `CS DS ES SS` (no hay `MOV sreg, imm` directo en el
  8086 real — cargá un registro de 16 bits primero: `mov ax, 1000h` /
  `mov ds, ax`).
- **Memoria**: `[BX]`, `[BX+SI]`, `[BX+DI]`, `[BP+SI]`, `[BP+DI]`,
  `[SI]`, `[DI]`, `[BP+disp]`, `[BX+disp]`, dirección directa `[etiqueta]`
  o `[0x1234]`, con override de segmento opcional `ES:[DI]`. Cuando el
  otro operando no es un registro (p. ej. `mov [bx], 5`), hay que
  aclarar el tamaño con `BYTE` o `WORD`.
- **Directivas**: `ORG`, `DB`, `DW`, `EQU`.

## Instrucciones implementadas

| Grupo | Instrucciones |
|---|---|
| Transferencia | `MOV` (reg/mem/imm/segreg), `PUSH`, `POP`, `PUSHA`, `POPA` (80186) |
| Aritmética/lógica | `ADD SUB CMP AND OR XOR INC DEC` |
| Multiplicación/división | `MUL IMUL DIV IDIV`, `IMUL r16,r/m16,imm16` (80186), `CBW CWD` |
| Shift/rotate | `SHL/SAL SHR SAR ROL ROR RCL RCR` (por 1, por `CL`, o por inmediato de 8 bits — extensión 80186) |
| Saltos | `JMP` y todos los `Jcc` (`JE JNE JG JL JB JAE ...`), `LOOP LOOPE/LOOPZ LOOPNE/LOOPNZ JCXZ` |
| Subrutinas | `CALL RET` |
| Cadenas | `MOVSB/W LODSB/W STOSB/W CMPSB/W SCASB/W`, con prefijo `REP`/`REPE`/`REPNE` |
| Pila con marco | `ENTER imm16,imm8` (sólo nivel de anidamiento 0), `LEAVE` |
| Banderas | `CLD STD CLI STI` |
| Interrupciones | `INT imm8` (ver subconjunto de `INT 21h` simulado abajo), `HLT` |
| Otras | `NOP` |

### `INT 21h` simulado (estilo DOS, sólo para los ejemplos de E/S)

| `AH` | Función |
|---|---|
| `02h` | Imprime el carácter en `DL` por la consola simulada. |
| `09h` | Imprime el string en `DS:DX`, terminado en `'$'`. |
| `4Ch` | Termina el programa (detiene la CPU, como `HLT`). |

Cualquier otro vector de interrupción o función `AH` no listada
imprime un aviso en la consola en vez de fallar silenciosamente.

## Limitaciones conocidas (a propósito, para no complicar el ensamblador)

- Un solo segmento de código por simulación: `CS = DS = ES = SS =
  0x1000` al reiniciar (se puede cambiar en tiempo de ejecución con
  `MOV DS, ax`, etc., como en un programa real).
- `JMP`/`CALL` siempre usan la forma "near" de 3 bytes; los saltos
  condicionales y `LOOP*`/`JCXZ` son siempre de 8 bits (si el destino
  queda a más de 127 bytes, el ensamblador avisa y sugiere invertir la
  condición + `JMP`).
- Los operandos de memoria con desplazamiento simbólico (`[bx+etiqueta]`)
  siempre usan disp16, y sólo se admite un símbolo por operando.
- `ENTER` no implementa niveles de anidamiento mayores a 0.
- No hay entrada interactiva (`INT 21h`/`AH=01h` de lectura de teclado,
  por ejemplo): el simulador es de un solo sentido (programa → consola).

## Arquitectura del código

```
index.html          Estructura de la página (editor, diagrama, pestañas)
css/styles.css       Tema oscuro + animaciones de las 4 etapas
js/isa.js            Tablas compartidas (registros, opcodes, flags)
js/cpu.js            Estado de la CPU: registros, memoria (1 MB), pila
js/assembler.js       Ensamblador de 2 pasadas -> bytes de máquina reales
js/decoder.js         Fetch+Decode: lee bytes desde CS:IP e interpreta
js/executor.js        Execute: calcula "micro-ops" sin mutar la CPU
js/cycle-engine.js    Orquesta Fetch->Decode->Execute->Writeback
js/examples.js        Los 8 programas de ejemplo
js/ui.js              Conecta todo con el DOM (la única pieza con DOM)
```

`assembler.js` y `decoder.js` son deliberadamente independientes (uno
genera bytes, el otro los interpreta) para que decodificar sea un
ejercicio real de lectura de memoria, no un atajo. `executor.js` nunca
escribe directamente sobre la CPU: devuelve una lista de "micro-ops"
que recién se aplican en la etapa Writeback — así es como la UI puede
animar Execute y Writeback como pasos distintos y mostrar, por
ejemplo, "la ALU calculó 7+3=10" un instante antes de "AX pasa a valer
10".

Los módulos `isa.js`, `cpu.js`, `assembler.js`, `decoder.js`,
`executor.js` y `cycle-engine.js` funcionan tanto como `<script>` en el
navegador como módulos de Node (para poder testear la lógica sin
abrir un navegador).
