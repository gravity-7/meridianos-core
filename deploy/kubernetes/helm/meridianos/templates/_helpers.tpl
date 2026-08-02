{{/*
Expand the name of the chart.
*/}}
{{- define "meridianos.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name. Truncated to 63 chars (DNS label limit).
*/}}
{{- define "meridianos.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart name and version, for the chart label.
*/}}
{{- define "meridianos.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels.
*/}}
{{- define "meridianos.labels" -}}
helm.sh/chart: {{ include "meridianos.chart" . }}
{{ include "meridianos.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Base selector labels shared by every component (deployment-agnostic).
*/}}
{{- define "meridianos.selectorLabels" -}}
app.kubernetes.io/name: {{ include "meridianos.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Per-component name, e.g. "meridianos-gateway".
*/}}
{{- define "meridianos.componentName" -}}
{{- printf "%s-%s" (include "meridianos.fullname" .context) .component -}}
{{- end -}}

{{/*
Per-component selector labels — pass a dict with "context" (the root $) and "component" (string).
*/}}
{{- define "meridianos.componentSelectorLabels" -}}
{{ include "meridianos.selectorLabels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Per-component labels.
*/}}
{{- define "meridianos.componentLabels" -}}
{{ include "meridianos.labels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Resolved image reference: repository:tag, with tag defaulting to .Chart.AppVersion.
*/}}
{{- define "meridianos.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{/*
Name of the Secret this release reads from — either the chart-managed one or an operator-supplied
existingSecret.
*/}}
{{- define "meridianos.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "meridianos.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Service account name.
*/}}
{{- define "meridianos.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "meridianos.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
