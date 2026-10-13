# Protocol · Hand-off between departments

Read when a task moves to another department (each department's *Hand-offs* says when).

Pass one line in this form, so the next one starts from facts instead of re-reading:
```
Hand-off → dept-<x>: hecho <what is decided/done> · necesita <what the next department must decide or build> · evidencia <paths, file:line, outputs> · abierto <open questions | ninguno>
```
The receiving department checks the evidence it relies on (memory and hand-offs point, the code decides) and continues with its own Entry.
