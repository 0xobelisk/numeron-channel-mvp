module numeron::map_system;

use dubhe::dapp_service::DappHub;
use numeron::position;
use std::ascii::String;
use dubhe::dapp_system;
use numeron::dapp_key::DappKey;
use dubhe::address_system;
use numeron::errors;
use numeron::item_dropped;
use numeron::item_type;
use std::ascii::string;

public entry fun force_register(dapp_hub: &mut DappHub, player: String, x: u64, y: u64, ctx: &mut TxContext) {
    dapp_system::ensure_dapp_admin<DappKey>(dapp_hub, ctx.sender());
    position::ensure_has_not(dapp_hub, player);
    position::set(dapp_hub, player, x, y, ctx);
}

public entry fun move_position(dapp_hub: &mut DappHub, direction: u8, ctx: &mut TxContext) {
    let player = address_system::ensure_origin<DappKey>(dapp_hub, ctx);
    errors::not_registered_error(position::has(dapp_hub, player));

    let (mut x, mut y) = position::get(dapp_hub, player);
    let mut item_type = item_type::new_ball();
    match (direction) {
        // north
        0 => {
            y = y - 1;
            item_type = item_type::new_currency();
        },
        // south
        1 => {
            y = y + 1;
            item_type = item_type::new_food();
        },
        // west
        2 => {
            x = x - 1;
            item_type = item_type::new_material();
        },
        // east
        3 => {
            x = x + 1;
            item_type = item_type::new_medicine();
        },
        _ => errors::invalid_direction_error(false),
    };
    position::set(dapp_hub, player, x, y, ctx);
    item_dropped::set(dapp_hub, player, item_type, ctx);
}
