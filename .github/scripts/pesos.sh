#!/usr/bin/env bash
# Define os pesos de um endpoint da Web Function e espera a atualização terminar.
#
#   .github/scripts/pesos.sh <endpoint> <revisão>=<peso> [<revisão>=<peso>]
#
# Usa FUNCTION_NAME do ambiente. Os pesos precisam somar 100 e as revisões precisam estar Active.
# A atualização é assíncrona: só depois de updateStatus=Successful o tráfego está como pedido.
set -euo pipefail

endpoint=$1
shift

pesos=()
for par in "$@"; do
  pesos+=("revisionId=${par%%=*},weight=${par##*=}")
done

aws lambda-web update-web-function-endpoint --function-name "$FUNCTION_NAME" \
  --endpoint-name "$endpoint" --revision-weights "${pesos[@]}" > /dev/null

for _ in $(seq 1 60); do
  status=$(aws lambda-web get-web-function-endpoint --function-name "$FUNCTION_NAME" \
    --endpoint-name "$endpoint" --query updateStatus --output text)
  case "$status" in
    Successful)
      echo "Endpoint $endpoint: $*"
      exit 0
      ;;
    Failed)
      aws lambda-web get-web-function-endpoint --function-name "$FUNCTION_NAME" \
        --endpoint-name "$endpoint" --query updateStatusReason --output text
      exit 1
      ;;
  esac
  sleep 5
done

echo "::error::Timeout esperando o endpoint $endpoint aplicar os pesos ($*)"
exit 1
