# Implementación de decisiones de carrera con Jev

Este documento define cómo FitAI usa Jev para interpretar una carrera sin delegarle reglas de seguridad ni cálculos fisiológicos. El sistema devuelve una decisión acotada: **subir suave, mantener, bajar suave, recuperar o pedir más datos**.

> Principio: el código calcula; Jev interpreta el contexto ambiguo; la política de seguridad manda. Jev no diagnostica ni puede autorizar continuar ante una señal de riesgo.

## Flujo

1. Normalizar métricas de reloj, móvil o Strava.
2. Construir una ventana reciente y compararla con el objetivo del bloque.
3. Ejecutar guardas deterministas de seguridad y calidad.
4. Si es seguro interpretar, hacer una llamada a Jev con estado reducido y preguntas en paralelo.
5. Aplicar confianza, límites y cooldown en código.
6. Mostrar un mensaje de plantilla y guardar auditoría.

## Responsabilidades

| Componente | Hace | No hace |
|---|---|---|
| Adaptador | Convierte fuentes a unidades, timestamps y calidad comunes | No rellena métricas ausentes |
| Motor de métricas | Calcula ritmo suavizado, diferencia con objetivo, tendencia FC, pendiente y frescura | No diagnostica |
| Política de seguridad | Bloquea subida ante síntomas, alertas o señal mala | No consulta a Jev para desbloquear un riesgo |
| Jev | Elige acciones y contexto dentro de opciones cerradas | No calcula ritmo, no genera consejo médico |
| Compositor | Une reglas, probabilidades, confianza y límites | No ignora guardas |
| Interfaz | Muestra acción, motivo y pide RPE | No oculta incertidumbre |
| Auditoría | Registra decisión y resultado | No guarda más datos personales de los necesarios |

## Estado que llega a Jev

La app no envía datos brutos infinitos. El backend consolida una ventana de 60 s para ritmo y de 90 s para FC.

~~~ts
type RunningContext = {
  sport: "running";
  block: "warmup" | "easy" | "tempo" | "interval" | "recovery";
  target: {
    paceSecPerKm?: { min: number; max: number };
    hrZone?: { min: number; max: number };
  };
  window: {
    durationSeconds: number;
    paceSecPerKm?: number;
    paceVsTargetSeconds?: number; // positivo = más lento
    heartRateBpm?: number;
    hrTrendBpmPerMin?: number;
    gradePct?: number;
    stoppedOrAutoPaused: boolean;
    signalQuality: "high" | "medium" | "low" | "unknown";
    dataAgeSeconds: number;
  };
  athlete: {
    rpe?: number; // 0–10
    symptomsReported: boolean;
    recoveryContext?: "below_usual" | "usual" | "above_usual" | "unavailable";
  };
  safety: {
    hardStop: boolean;
    mayIncreaseIntensity: boolean;
    missingRequiredMetric: boolean;
  };
};
~~~

No enviar a Jev la ruta completa, identificadores, histórico biométrico completo ni scores propietarios brutos. Una categoría calculada, como recoveryContext, es suficiente.

## Métricas y cómo se usan

| Métrica | Cálculo previo | Papel en la decisión |
|---|---|---|
| Ritmo | Media/mediana de 30–60 s, sin pausas | Compararlo con rango del bloque |
| FC | Ventana de 60–90 s y tendencia | Confirmar coste interno, nunca reaccionar a un pico |
| RPE | Pregunta 0–10 | Corregir lecturas ambiguas; RPE alto impide subir |
| Pendiente | Derivada de altitud/ruta | Explicar ritmo menor y moderar cambios |
| Calidad y edad | Fuente, precisión, última muestra | Guardas: sin señal fiable no hay cambio |
| Recovery/HRV/sueño | Categoría personal longitudinal | Prudencia inicial, no control por segundos |
| Calorías, pasos, SpO2, VO2max | Ninguno | No desencadenan decisiones V1 |

## Guardas que no se delegan

| Condición | Resultado obligatorio |
|---|---|
| Síntoma crítico, alerta manual o evento definido como grave | stop_and_escalate; no llamar a Jev |
| Dolor o síntoma sin clasificar | hold_and_check; nunca subir |
| Muestra de más de 15 s, señal baja, autopausa o GPS inválido | insufficient_data; no cambiar |
| Bloque warmup o recovery | Nunca subir automáticamente |
| No hay ritmo ni FC | insufficient_data; pedir RPE o esperar |
| Recomendación recién aplicada | Cooldown de 60–90 s; evitar inversiones |

Los umbrales de piloto no son valores médicos universales y deben calibrarse con sesiones revisadas.

## Preguntas tipadas que hará Jev

Todas ven el mismo estado y son independientes; se envían en una sola petición de System One.

| Pregunta | Tipo TypeSafe | Qué habilita |
|---|---|---|
| Acción de esfuerzo | Choice | Elegir entre cinco acciones cerradas |
| Esfuerzo desproporcionado | Noul | Impedir subida y apoyar reducción |
| Contexto explicativo | Choice | Seleccionar una explicación no médica |
| Interpretabilidad | Score | Determinar si se puede actuar con confianza |

### Acción de esfuerzo: Choice

| Opción | Criterio |
|---|---|
| increase_gently | Solo easy, ritmo sostenidamente bajo, esfuerzo bajo, señal fiable y permiso de seguridad |
| maintain | Ritmo/esfuerzo encajan con el plan o la variación es normal |
| decrease_gently | El coste interno o RPE parece alto para el bloque, sin emergencia |
| recover | El bloque intenso no se tolera y debe pasar a recuperación |
| insufficient_evidence | Contexto incompleto, antiguo o ambiguo |

### Esfuerzo desproporcionado: Noul

La pregunta responde a: “Con objetivo, ritmo, tendencia de FC, RPE y pendiente, ¿el esfuerzo aparente es desproporcionado para este bloque?”

Noul devuelve la probabilidad de sí. No es una escala de fatiga ni un diagnóstico. Una probabilidad alta impide subir; una intermedia mantiene una decisión conservadora.

### Contexto y calidad: Choice + Score

La explicación es una Choice entre uphill_or_terrain, pace_below_target, likely_heat_or_fatigue, normal_variation y not_enough_context. Es una etiqueta para una plantilla; no afirma una causa médica.

La interpretabilidad es una Score con tres niveles ordenados:

1. Unusable: faltan mediciones, son antiguas, contradictorias o incomparables.
2. Limited: hay datos, pero pendiente, RPE o referencia personal no aclaran el patrón.
3. Clear: objetivo, ritmo, FC, RPE, terreno y calidad forman un cuadro coherente.

El compositor usa score, distribución de probabilidades y confidence. Un score intermedio con baja confidence se trata como limited.

## Llamada de backend con SDK JavaScript

Las claves permanecen en servidor.

~~~ts
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();

const response = await client.systemOne({
  model: "jev-latest",
  state: runningContext,
  questions: {
    effort_action: choice(
      "For the current running block, select the most conservative training action. Do not diagnose illness. Respect safety in state.",
      {
        increase_gently: "Easy block only; pace below target, low effort, reliable recent data, and safety permits a small increase.",
        maintain: "Pace and apparent effort fit the planned block, or variation is normal.",
        decrease_gently: "Apparent effort is higher than intended, without an emergency signal.",
        recover: "The intense block appears poorly tolerated and the runner should transition to recovery.",
        insufficient_evidence: "Context is incomplete, stale, or ambiguous.",
      },
    ),
    effort_disproportionate: noul(
      "Is apparent effort disproportionate for this running block and target pace, considering heart-rate trend, RPE, grade, and data quality?",
    ),
    context_explanation: choice(
      "Which non-medical context best explains this pace-versus-effort pattern?",
      {
        uphill_or_terrain: "Terrain or grade plausibly explains it.",
        pace_below_target: "Runner is below planned easy pace without excess effort.",
        likely_heat_or_fatigue: "Effort is elevated for comparable pace; this is a training-context label, not a diagnosis.",
        normal_variation: "Deviation is small or expected.",
        not_enough_context: "State cannot support an explanation.",
      },
    ),
    context_interpretability: score(
      "How interpretable is this context for a conservative pacing decision?",
      [
        "Unusable: missing, stale, contradictory, or incomparable data.",
        "Limited: key metrics exist but the pattern remains ambiguous.",
        "Clear: target, pace, heart rate, RPE, terrain, and quality form a consistent picture.",
      ],
    ),
  },
});
~~~

El contrato se basa en estado JSON estructurado y preguntas Choice, Noul y Score de TypeSafe. Validar la firma exacta contra la versión instalada del SDK antes de implementar. [SDK JavaScript](https://docs.typesafe.ai/sdk/javascript), [State](https://docs.typesafe.ai/concepts/state) y [primitivas](https://docs.typesafe.ai/primitives).

## Composición de la decisión

La respuesta de Jev nunca es la decisión final.

~~~ts
function decide(context: RunningContext, answers: JevAnswers): FinalDecision {
  if (context.safety.hardStop) return { action: "stop_and_escalate" };

  if (context.safety.missingRequiredMetric ||
      context.window.signalQuality === "low" ||
      context.window.dataAgeSeconds > 15) {
    return { action: "insufficient_data" };
  }

  const action = answers.effort_action;
  const clearEnough =
    answers.context_interpretability.confidence >= 0.75 &&
    answers.context_interpretability.score >= 1.4;

  if (action.confidence < 0.70 || !clearEnough) {
    return { action: "maintain", reason: "uncertain_context" };
  }

  if (action.choice === "increase_gently") {
    if (!context.safety.mayIncreaseIntensity ||
        context.block !== "easy" ||
        answers.effort_disproportionate.noul >= 0.30) {
      return { action: "maintain", reason: "increase_not_permitted" };
    }
    return { action: "increase_gently", maxChange: "5_to_10_sec_per_km", recheckInSeconds: 60 };
  }

  if (action.choice === "recover") return { action: "recover", recheckInSeconds: 90 };
  if (action.choice === "decrease_gently") {
    return { action: "decrease_gently", maxChange: "5_to_15_sec_per_km", recheckInSeconds: 60 };
  }
  return { action: "maintain", recheckInSeconds: 60 };
}
~~~

Los valores de confidence y los ajustes máximos son propuestas de piloto. El equipo debe cambiarlos con datos etiquetados, no asumir que son umbrales fisiológicos.

## Mensajes que verá el corredor

Jev no genera texto libre. La interfaz usa plantillas controladas.

| Acción | Mensaje |
|---|---|
| increase_gently | “Vas por debajo del ritmo fácil previsto y tus datos son estables. Sube ligeramente durante el próximo minuto.” |
| maintain | “Vas dentro del rango previsto. Mantén este ritmo.” |
| decrease_gently | “El esfuerzo parece alto para este bloque. Baja un poco y revisa tus sensaciones.” |
| recover | “Pasa a recuperación. Priorizamos completar la sesión con control.” |
| insufficient_data | “No tengo datos fiables para cambiar el ritmo. Comprueba el reloj o indica tu esfuerzo de 0 a 10.” |
| stop_and_escalate | “Detén el ejercicio y busca ayuda según la gravedad de los síntomas.” |

## Frecuencia, errores y privacidad

- No llamar a Jev cada segundo: al cambio de bloque y como máximo una vez por 60 s estables.
- Tras una recomendación, aplicar cooldown de 60–90 s.
- En fallo, timeout o rate limit: mantener; registrar error; nunca intensificar.
- Enviar solo estado reducido y actual.
- Guardar credenciales solo en backend.
- Registrar versión de modelo, estado reducido, preguntas, probabilidades, confidence, reglas y acción final.
- Separar identidad de las series de actividad y permitir borrado/exportación.

## Validación

| Prueba | Resultado requerido |
|---|---|
| Datos incompletos | Nunca subir si falta FC, ritmo o señal fiable |
| Sensor ruidoso | Insufficient_data o maintain, sin oscilación |
| Carrera easy realmente suave | Una subida limitada si todos los datos concuerdan |
| FC o RPE altos | Nunca subir; reducir o recuperar según bloque |
| Cuesta | No interpretar ritmo bajo como falta de esfuerzo |
| Síntoma | Saltar Jev y activar seguridad |
| Confidence baja | Mantener; no acción agresiva |
| Revisión de experto | Comparar decisión y explicación con sesiones etiquetadas |

## Fuera de alcance V1

- Diagnóstico, arritmias, prevención de lesión o consejo médico.
- Decisiones desde calorías, SpO2 o índices propietarios.
- Personalización que infiera condición médica.
- Intensificar sin señales actuales fiables.
- Texto libre de Jev dirigido al corredor.

## Referencias

- [System One](https://docs.typesafe.ai/concepts/system-one)
- [State](https://docs.typesafe.ai/concepts/state)
- [Choice](https://docs.typesafe.ai/primitives/choice)
- [Noul](https://docs.typesafe.ai/primitives/noul)
- [Score](https://docs.typesafe.ai/primitives/score)
- [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing)

## Siguiente paso

Implementar primero un simulador de ventanas de carrera y los casos de validación anteriores. Con resultados consistentes, conectar una fuente real de datos y evaluar concordancia con un entrenador.

