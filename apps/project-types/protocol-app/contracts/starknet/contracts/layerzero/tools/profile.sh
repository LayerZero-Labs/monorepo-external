#!/bin/sh

set -e

view_profile() {
  test_suite_name=test_$1
  test_name=test_$2
  contract=$3
  function=$4

  file=$(find profile -type f -name "*${test_suite_name}_$test_name.pb.gz")

  cairo-profiler view --limit 10000 --sample 'sierra gas' $file |
    grep "Contract: $contract" |
    grep "Function: $function" |
    sed 's/ *| */|/g' |
    sed 's/"//g' |
    sed 's/\\n/\t/g' |
    cut -f 4,6 -d '|' |
    awk -F '|' -v name=$test_name 'BEGIN { OFS="\t" } { print name,$2,$1; }' |
    sed -E 's/(Contract|Function): //g'
}

scarb test \
  --release \
  --features gas_profile \
  --build-profile \
  --tracked-resource sierra-gas \
  --max-n-steps 4294967295 \
  gas_profile

{
  view_profile counter_increment increment OmniCounter increment
  view_profile dvn_verify verify Dvn execute
  view_profile executor_native_drop native_drop Executor native_drop
  view_profile uln_commit commit UltraLightNode302 commit

  for function in set_price set_price_for_arbitrum set_native_price_usd; do
    view_profile price_feed $function PriceFeed $function
  done

  for index in $(seq 0 5); do
    view_profile executor_compose compose_$index Executor compose
    view_profile executor_execute execute_$index Executor execute

    for function in lz_receive_alert lz_compose_alert; do
      view_profile endpoint_alert ${function}_$index EndpointV2 $function
    done
  done
} | sort
