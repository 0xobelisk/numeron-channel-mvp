#[test_only]
module numeron::map_test;
use sui::test_scenario;
use numeron::map_system;
use numeron::init_test;
use std::ascii::string;
use std::address;
use dubhe::address_system;

#[test]
fun move_position_should_work(){
        let sui_player = @0xbd1db4accf9ccb64e3fce45d4d1ae1576f926a541ce098f8cb5f79fe6a7a585b;
        let evm_player = b"f464dab2f6386ea829f6a15cbe6a6267d01f91be";
        let solana_player = b"FoaSmLuvwmWWYTqnQQoE6wpAALQczJqgebhtV1v67DLm";
        let mut scenario  = test_scenario::begin(sui_player);
        let mut dapp_hub = init_test::deploy_dapp_for_testing(&mut scenario);

        {
           let ctx = test_scenario::ctx(&mut scenario);
           map_system::move_position(&mut dapp_hub, 1, ctx);
        };

        address_system::setup_evm_scenario(&mut scenario, evm_player);
        {
           let ctx = test_scenario::ctx(&mut scenario);
           map_system::move_position(&mut dapp_hub, 1, ctx);
        };

        address_system::setup_solana_scenario(&mut scenario, solana_player);
        {
           let ctx = test_scenario::ctx(&mut scenario);
           map_system::move_position(&mut dapp_hub, 1, ctx);
        };




        dapp_hub.destroy();
        scenario.end();
}