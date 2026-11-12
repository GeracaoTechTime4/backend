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
# Pesos pedidos, no formato que o jq devolve abaixo, para comparar com os do endpoint.
esperado=$(printf '%s\n' "$@" | LC_ALL=C sort | paste -sd' ' -)

aws lambda-web update-web-function-endpoint --function-name "$FUNCTION_NAME" \
  --endpoint-name "$endpoint" --revision-weights "${pesos[@]}" > /dev/null

# Logo depois do update, a API ainda pode mostrar o Successful da atualização anterior: só vale
# quando os pesos do endpoint já forem os pedidos.
for _ in $(seq 1 60); do
  estado=$(aws lambda-web get-web-function-endpoint --function-name "$FUNCTION_NAME" \
    --endpoint-name "$endpoint" --output json)
  status=$(jq -r '.updateStatus // "None"' <<< "$estado")
  atual=$(jq -r '[.revisionWeights[] | "\(.revisionId)=\(.weight)"] | sort | join(" ")' <<< "$estado")
  case "$status" in
    Successful)
      if [ "$atual" = "$esperado" ]; then
        echo "Endpoint $endpoint: $atual"
        exit 0
      fi
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
