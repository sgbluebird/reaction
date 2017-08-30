import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Cart } from "/lib/collections";
import { Logger, Hooks } from "/server/api";
import { Cart as CartSchema } from "/lib/collections/schemas";

/*
 * Reaction Shipping Methods
 * methods typically used for checkout (shipping, taxes, etc)
 */
export const methods = {
  /**
   * shipping/updateShipmentQuotes
   * @summary gets shipping rates and updates the users cart methods
   * @todo add orderId argument/fallback
   * @param {String} cartId - cartId
   * @return {undefined}
   */
  "shipping/updateShipmentQuotes": function (cartId) {
    check(cartId, String);
    if (!cartId) {
      return [];
    }
    this.unblock();
    const cart = Cart.findOne(cartId);
    check(cart, CartSchema);

    if (cart) {
      const rates = Meteor.call("shipping/getShippingRates", cart);
      let selector;
      let update;

      // Temp hack until we build out multiple shipment handlers.
      // If we have an existing item update it, otherwise add to set.
      if (cart.shipping) {
        selector = { _id: cartId };
        update = {
          $set: {
            "shipping.0.shipmentQuotesQueryStatus": {
              requestStatus: "pending"
            }
          }
        };

        if (rates.length === 1 && rates[0].requestStatus === "error") {
          const errorDetails = rates[0];
          update = {
            $set: {
              "shipping.0.shipmentQuotesQueryStatus": {
                requestStatus: errorDetails.requestStatus,
                shippingProvider: errorDetails.shippingProvider,
                message: errorDetails.message
              }
            }
          };
        }

        if (rates.length > 0 && rates[0].requestStatus === undefined) {
          selector = {
            "_id": cartId,
            "shipping._id": cart.shipping[0]._id
          };
          update = {
            $set: {
              "shipping.$.shipmentQuotes": rates,
              "shipping.$.shipmentQuotesQueryStatus": {
                requestStatus: "success",
                numOfShippingMethodsFound: rates.length
              }
            }
          };
        }
      } else {
        selector = { _id: cartId };
        update = {
          $push: {
            shipping: {
              shipmentQuotes: rates,
              shipmentQuotesQueryStatus: {
                requestStatus: "pending"
              }
            }
          }
        };

        if (rates.length === 1 && rates[0].requestStatus === "error") {
          const errorDetails = rates[0];
          update = {
            $push: {
              shipping: {
                shipmentQuotes: rates,
                shipmentQuotesQueryStatus: {
                  requestStatus: errorDetails.requestStatus,
                  shippingProvider: errorDetails.shippingProvider,
                  message: errorDetails.message
                }
              }
            }
          };
        }

        if (rates.length > 0 && rates[0].requestStatus === undefined) {
          update = {
            $push: {
              shipping: {
                shipmentQuotes: rates,
                shipmentQuotesQueryStatus: {
                  requestStatus: "success",
                  numOfShippingMethodsFound: rates.length
                }
              }
            }
          };
        }
      }

      // add quotes to the cart
      Cart.update(selector, update, function (error) {
        if (error) {
          Logger.warn(`Error adding rates to cart ${cartId}`, error);
          return;
        }
        Logger.debug(`Success adding rates to cart ${cartId}`, rates);
      });
    }
  },

  /**
   * shipping/getShippingRates
   * @summary just gets rates, without updating anything
   * @param {Object} cart - cart object
   * @return {Array} return updated rates in cart
   */
  "shipping/getShippingRates": function (cart) {
    check(cart, CartSchema);
    const rates = [];
    const retrialTargets = [];
    // must have items to calculate shipping
    if (!cart.items) {
      return rates;
    }
    // hooks for other shipping rate events
    // all callbacks should return rates
    Hooks.Events.run("onGetShippingRates", [rates, retrialTargets], cart);

    // Try once more.
    if (retrialTargets.length > 0) {
      Hooks.Events.run("onGetShippingRates", [rates, retrialTargets], cart);

      if (retrialTargets.length > 0) {
        Logger.warn("Failed to get shipping methods from these packages:", retrialTargets);
      }
    }

    Logger.debug("getShippingRates returning rates", rates);
    return rates;
  }
};

Meteor.methods(methods);
