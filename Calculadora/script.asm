;Ejercicio:
;Generar el numero N de la sucesion de Fibonacci
;dicha sucesion inicia en 1 y continua 1 1 2 3 5 8...
;queda fuera de alcance el paso inicial 0
;se opera solamente con valores enteros sin signar

main PROC
  ;Inicializo los registros
  MOV AX, 0000 ;Paso AUX o Paso X - 1
  MOV BX, 0001 ;Paso X
  MOV CX, 0005 ;Paso N o paso meta del ejercicio
  
  JCXZ terminar

  CMP CX, 18 ;Si el paso es el 24 daria overflow en BX, asi que salgo del programa
  JA terminar

  CALL next_step ;Llamo a la subturina que calcula la sucesion
terminar:
  MOV AX, 4C00h      ; Función para terminar el programa de manera correcta
  INT 21h
main ENDP

;Subrutina para calcular el siguiente paso
next_step PROC
  DEC CX ;Disminuyo el contador
  JZ salir_step
  PUSH BX ;Guardo BX en la pila
  Add BX, AX ;calculo el siguiente paso
  POP AX ;Guardo anterior paso en AX, valor de la pila que era de BX
  CALL next_step

salir_step:
  RET
next_step ENDP

END main

;Ejercicio:
;Calcular el factorial del numero N (N!)
;el factorial se define como N! = N x (N-1) x (N-2) x ... x 1
;por convencion, 0! = 1
;se opera solamente con valores enteros sin signar
;restriccion: usar MUL y LOOP

main PROC
  ;Inicializo los registros
  MOV CX, 0007 ;Calculo el factorial de CX
  MOV AX, 0001 ;Primer valor de AX es 1

  JCXZ terminar ;Si CX es 0, salgo del programa

  CMP CX, 7 ;Si el paso es el 7 daria overflow en AX, asi que salgo del programa
  JA terminar

  inicio_loop:
    MUL CX ;Multiplico AX por CX
    LOOP inicio_loop ;Repite hasta que CX sea 0
  
terminar:
  MOV AX, 4C00h      ; Función para terminar el programa de manera correcta
  INT 21h
main ENDP

;Ejercicio:
;Dado un arreglo de N valores declarado en memoria,
;invertir el orden de sus elementos
;ejemplo: [1, 2, 3, 4, 5] -> [5, 4, 3, 2, 1]
;se opera solamente con valores enteros sin signar
;restriccion: usar direccionamiento indexado (SI/DI) y
;dos punteros (uno desde el inicio y otro desde el final del arreglo)
;para intercambiar los valores en el propio arreglo (in-place)

mov SI, arreglo ;Puntero al inicio del arreglo
mov CX, 000A ;Cantidad de elementos del arreglo

inicio_loop_guardar:
  mov AL, [SI]     ;leo el byte actual del arreglo
  mov AH, 0        ;AH en 0 para pushear un word valido
  push AX ;Guardo el valor del arreglo en la pila
  inc SI ;Avanzo el puntero al siguiente elemento
  loop inicio_loop_guardar

mov cx, 000A ;Cantidad de elementos del arreglo
mov SI, arreglo ;Puntero al inicio del arreglo

inicio_loop_invertir:
  pop AX ;Recupero el valor de la pila
  mov [SI], AL ;guardo solo el byte bajo en el arreglo
  loop inicio_loop_invertir

arreglo db 01h, 02h, 03h, 04h, 05h, 06h, 07h, 08h, 09h, 0Ah ;Arreglo de 10 elementos
