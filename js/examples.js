// examples.js — Biblioteca de programas de ejemplo en ensamblador 80186,
// seleccionables desde el simulador para cargar directamente en el editor.
(function (global) {
  'use strict';

  const EXAMPLES = [
    {
      id: 'aritmetica',
      title: '1. Aritmética básica',
      description: 'MOV, ADD, SUB, CMP entre registros e inmediatos.',
      code:
`; Ejemplo 1: aritmética básica
; Muestra cómo se cargan valores inmediatos en registros y cómo la ALU
; realiza sumas, restas y comparaciones actualizando los FLAGS.

mov ax, 5         ; AX = 5
mov bx, 3         ; BX = 3
add ax, bx        ; AX = AX + BX = 8
sub ax, 2         ; AX = AX - 2 = 6
mov cx, ax        ; CX = 6
cmp cx, 6         ; compara CX con 6 -> ZF=1 porque son iguales
hlt
`
    },
    {
      id: 'bucle',
      title: '2. Bucle con LOOP',
      description: 'JMP/LOOP para sumar 1+2+3+4+5 usando un contador.',
      code:
`; Ejemplo 2: bucle con LOOP
; LOOP decrementa CX automáticamente y salta mientras CX <> 0.
; Al final AX debería valer 15 (1+2+3+4+5).

mov cx, 5         ; contador de vueltas
mov ax, 0         ; acumulador
mov bx, 1         ; valor a sumar en cada vuelta

otra_vuelta:
  add ax, bx
  inc bx
  loop otra_vuelta

hlt
`
    },
    {
      id: 'pila',
      title: '3. Pila y subrutinas',
      description: 'PUSH/POP/CALL/RET, mostrando el efecto en SS:SP.',
      code:
`; Ejemplo 3: pila y subrutinas
; CALL guarda la dirección de retorno en la pila (SS:SP) y RET la recupera.

mov ax, 10
call duplicar     ; AX = duplicar(AX)
mov bx, ax        ; BX = 20
hlt

duplicar:
  add ax, ax      ; AX = AX * 2
  ret
`
    },
    {
      id: 'cadena',
      title: '4. Cadena de bytes (REP MOVSB)',
      description: 'MOVSB con REP para copiar un bloque byte a byte.',
      code:
`; Ejemplo 4: cadena de bytes con REP MOVSB
; SI apunta al origen, DI al destino (vía DS y ES respectivamente).
; CLD pone DF=0 para que SI/DI avancen (en vez de retroceder).

mov si, origen
mov di, destino
mov cx, 5
cld
rep movsb
hlt

origen db 'ITRIS'
destino db 0, 0, 0, 0, 0
`
    },
    {
      id: 'muldiv',
      title: '5. Multiplicación y división',
      description: 'MUL y DIV usando el par DX:AX.',
      code:
`; Ejemplo 5: multiplicación y división
; MUL de 16 bits deja el resultado en DX:AX. DIV usa DX:AX como dividendo.

mov ax, 6
mov bx, 7
mul bx            ; DX:AX = 6 * 7 = 42
mov cx, ax        ; CX = 42

mov ax, 100
mov bx, 9
xor dx, dx        ; limpiar DX antes de dividir (dividendo = DX:AX)
div bx            ; AX = cociente (11), DX = resto (1)
hlt
`
    },
    {
      id: 'shifts',
      title: '6. Shifts y rotates',
      description: 'SHL/SHR/ROL con inmediato de 8 bits (extensión 80186).',
      code:
`; Ejemplo 6: shifts y rotates
; En el 8086 original, desplazar más de 1 bit requería repetir la
; instrucción o usar CL. El 80186 agregó la forma con inmediato directo.

mov ax, 1
shl ax, 4         ; AX = 1 << 4 = 16

mov bx, 0FFh
shr bx, 4         ; BX = 0FFh >> 4 = 0Fh

mov cx, 0F0h
rol cx, 4         ; rota 4 bits a la izquierda
hlt
`
    },
    {
      id: 'marcopila',
      title: '7. PUSHA/POPA y ENTER/LEAVE',
      description: 'Extensiones propias del 80186 para manejo de pila.',
      code:
`; Ejemplo 7: extensiones del 80186 para la pila
; PUSHA/POPA guardan y restauran los 8 registros de 16 bits de una sola vez.
; ENTER/LEAVE arman y desarman un marco de pila (como en un lenguaje de
; alto nivel, para variables locales referenciadas vía BP).

mov ax, 1
mov bx, 2
mov cx, 3
mov dx, 4
pusha             ; guarda AX,CX,DX,BX,SP,BP,SI,DI
mov ax, 0
mov bx, 0
popa              ; restaura los registros guardados (AX vuelve a valer 1)

mov bp, 0
enter 4, 0        ; reserva 4 bytes locales en la pila (BP = tope del marco)
mov word [bp-2], 55
mov ax, [bp-2]    ; AX = 55 (leído desde la variable local)
leave             ; destruye el marco de pila
hlt
`
    },
    {
      id: 'interrupcion',
      title: '8. Entrada/salida simulada (INT 21h)',
      description: 'INT 21h para imprimir por la consola simulada y salir.',
      code:
`; Ejemplo 8: entrada/salida simulada con INT 21h
; El simulador implementa un mini subconjunto de INT 21h (estilo DOS):
;   AH=02h, DL=carácter  -> imprime un carácter
;   AH=09h, DX=dirección -> imprime un string terminado en '$'
;   AH=4Ch                -> termina el programa

mov dl, 'A'
mov ah, 2
int 21h

mov dx, mensaje
mov ah, 9
int 21h

mov ah, 4Ch
int 21h

mensaje db ' - Hola desde el 80186!$'
`
    }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = { EXAMPLES };
  else global.EXAMPLES = EXAMPLES;
})(typeof window !== 'undefined' ? window : globalThis);
