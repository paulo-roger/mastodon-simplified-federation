/**
 * This mdoules contains the custom triggers for some options that are added.
 *
 * @module modules/CustomOptionTriggers
 */

import isPlainObject from "/common/modules/lodash/isPlainObject.js";

import { UnknownAccountError } from "/common/modules/Errors.js";

import * as Mastodon from "/common/modules/Mastodon.js";
import * as MastodonApi from "/common/modules/MastodonApi.js";
import * as AutomaticSettings from "/common/modules/AutomaticSettings/AutomaticSettings.js";
import * as CommonMessages from "/common/modules/MessageHandler/CommonMessages.js";

// Mastodon handle state management
const MASTODON_HANDLE_IS_INVALID = Symbol("invalid Mastodon handle");
const MASTODON_HANDLE_IS_EMPTY = Symbol("empty Mastodon handle");
const MASTODON_HANDLE_IS_NON_EXISTANT = Symbol("Mastodon account does not exist");
const MASTODON_HANDLE_NETWORK_ERROR = Symbol("Mastodon server could not be contacted, network error.");
const MASTODON_NO_MASTODON_SERVER = Symbol("Server is no Mastodon server");
const MASTODON_HANDLE_CHECK_FAILED = Symbol("Could not check Mastodon handle");

let mastodonHandleErrorShown = null;
let lastInvalidMastodonHandle = null;

/**
 * Hides the error/warning shown for the Mastodon handle.
 *
 * @function
 * @param {Object} options
 * @private
 * @returns {void}
 */
function hideMastodonError(options = {animate: true}) {
    switch (mastodonHandleErrorShown) {
    case MASTODON_HANDLE_IS_EMPTY:
        CommonMessages.hideWarning(options);
        break;
    case MASTODON_HANDLE_IS_INVALID:
    case MASTODON_HANDLE_IS_NON_EXISTANT:
    case MASTODON_HANDLE_NETWORK_ERROR:
    case MASTODON_NO_MASTODON_SERVER:
    case MASTODON_HANDLE_CHECK_FAILED:
        CommonMessages.hideError(options);
        break;
    }

    mastodonHandleErrorShown = null;
}


/**
 * Hides the error/warning shown for the Mastodon handle.
 *
 * @function
 * @param {MASTODON_HANDLE_IS_EMPTY|MASTODON_HANDLE_IS_INVALID} type
 * @param {string} optionValue
 * @private
 * @returns {void}
 */
function showMastodonHandleError(type, optionValue) {
    // hide "old" error, if needed
    hideMastodonError({animate: false});

    switch (type) {
    case MASTODON_HANDLE_IS_EMPTY:
        CommonMessages.showWarning("mastodonHandleIsEmpty");
        break;
    case MASTODON_HANDLE_IS_INVALID:
        CommonMessages.showError("mastodonHandleIsInvalid");
        break;
    case MASTODON_HANDLE_IS_NON_EXISTANT:
        CommonMessages.showError("mastodonHandleDoesNotExist");
        break;
    case MASTODON_HANDLE_NETWORK_ERROR:
        CommonMessages.showError("mastodonHandleServerCouldNotBeContacted");
        break;
    case MASTODON_NO_MASTODON_SERVER:
        CommonMessages.showError("isNoMastodonServer");
        break;
    case MASTODON_HANDLE_CHECK_FAILED:
        CommonMessages.showError("mastodonHandleCheckFailed");
        break;
    default:
        throw new TypeError("invalid error type has been given");
    }

    mastodonHandleErrorShown = type;
    lastInvalidMastodonHandle = optionValue;
}

/**
 * Checks if the Mastodon handle is valid and shows an error, if needed.
 *
 * @function
 * @private
 * @param  {boolean} optionValue
 * @param  {string} [option]
 * @returns {Promise} (split mastodon handle & accountLink)
 */
async function checkMastodonHandle(optionValue) {
    // default option, string not yet set
    if (optionValue === null) {
        showMastodonHandleError(MASTODON_HANDLE_IS_EMPTY, optionValue);
        // do NOT throw error as first loading has to suceed!
        return null;
    }

    // ignore options directly loaded from the settings, these are always valid
    if (isPlainObject(optionValue)) {
        // hide "old" error, if needed
        hideMastodonError({animate: false});

        return null;
    }

    // simple empty check
    if (optionValue === "") {
        showMastodonHandleError(MASTODON_HANDLE_IS_EMPTY, optionValue);
        throw new Error("empty Mastodon handle");
    }

    // check vadility (syntax)
    let splitHandle;
    try {
        splitHandle = Mastodon.splitUserHandle(optionValue);
    } catch (error) {
        showMastodonHandleError(MASTODON_HANDLE_IS_INVALID, optionValue);

        // re-throw to prevent saving
        throw error;
    }

    // check existance of handle (and/on) server
    const accountLink = await Mastodon.getAccountLink(splitHandle).catch(async (error) => {
        const isMastodonServer = await MastodonApi.isMastodonServer(splitHandle.server).then((isMastodonServer) => {
            // ignore, if it is a valid Mastodon server
            if (isMastodonServer) {
                return true;
            }

            showMastodonHandleError(MASTODON_NO_MASTODON_SERVER, optionValue);
            return false;
        }).catch(console.error);

        // only if we are sure it is no Mastodon server display that as a result
        if (isMastodonServer === false) {
            // re-throw to prevent saving
            throw error;
        }

        if (error instanceof UnknownAccountError) {
            showMastodonHandleError(MASTODON_HANDLE_IS_NON_EXISTANT, optionValue);
        } else if (error instanceof TypeError) {
            // error by .fetch, likely unknown/wrong server
            showMastodonHandleError(MASTODON_HANDLE_NETWORK_ERROR, optionValue);
        } else {
            showMastodonHandleError(MASTODON_HANDLE_CHECK_FAILED, optionValue);
        }

        // re-throw to prevent saving
        throw error;
    });

    // if saving worked, maybe we need to hide the error though
    hideMastodonError();
    mastodonHandleErrorShown = null;
    return {splitHandle, accountLink};
}

/**
 * Saves the Mastodon handle.
 *
 * @private
 * @param {Object} param
 * @param {Object} param.optionValue the value of the changed option
 * @param {string} param.option the name of the option that has been changed
 * @param {Array} param.saveTriggerValues all values returned by potentially
 *                                          previously run safe triggers
 * @returns {Promise}
 */
function saveMastodonHandle(param) {
    // our split handle from {@see checkMastodonHandle()} is saved in saveTriggerValues
    const splitHandle = param.saveTriggerValues[0].splitHandle;

    // while we have time, also pre-query subscribe API template
    Mastodon.getSubscribeApiTemplate(splitHandle, true);

    return AutomaticSettings.Trigger.overrideContinue(splitHandle);
}

/**
 * Concatenates the Mastodon handle, so an object fits into a text input field. ;)
 *
 * @private
 * @param {Object} param
 * @param {Object} param.optionValue the value of the option to be loaded
 * @param {string} param.option the name of the option that has been changed
 * @param {HTMLElement} param.elOption where the data is supposed to be loaded
 *                     into
 * @param {Object} param.optionValues result of a storage.[…].get call, which
 *                  contains the values that should be applied to the file
 * @returns {Promise}
 */
function prepareMastodonHandleForInput(param) {
    // our split handle in a split form
    let ownMastodon = param.optionValue;

    // if default, we show an empty string
    if (ownMastodon === null) {
        return AutomaticSettings.Trigger.overrideContinue("");
    }

    if (ownMastodon.username && ownMastodon.server) {
        ownMastodon = Mastodon.concatUserHandle(ownMastodon.username, ownMastodon.server);
    }

    return AutomaticSettings.Trigger.overrideContinue(ownMastodon);
}

/**
 * Checks whether Mastodon handle is valid again, and – if so – hides the errors.
 *
 * Note this does not show any errors in order not to annoy a user when they are
 * typing.
 *
 * @function
 * @private
 * @param  {boolean} optionValue
 * @param  {string} [option]
 * @returns {void}
 */
function checkMastodonHandleFast(optionValue) {
    // if error has been hidden by typing only, and user reverts to invalid input
    // we need to show the error again
    // The problem is that for the same input the "change" event is not triggered.
    if (!mastodonHandleErrorShown && lastInvalidMastodonHandle === optionValue) {
        checkMastodonHandle(optionValue);
        lastInvalidMastodonHandle = null;
        return;
    }

    if (!mastodonHandleErrorShown) {
        return;
    }

    switch (mastodonHandleErrorShown) {
    case MASTODON_HANDLE_IS_EMPTY:
        if (optionValue !== "") {
            return;
        }
        break;
    case MASTODON_HANDLE_IS_INVALID:
        try {
            Mastodon.splitUserHandle(optionValue);

        } catch (e) {
            // cache value that is considered an error
            lastInvalidMastodonHandle = optionValue;

            // ignore all errors
            return;
        }
        break;
    }

    // if it works, the user managed to fix the previously reported error! :)
    hideMastodonError();
}

/**
 * Binds the triggers.
 *
 * This is basically the "init" method.
 *
 * @function
 * @returns {void}
 */
export function registerTrigger() {
    // override load/safe behaviour for custom fields
    AutomaticSettings.Trigger.addCustomLoadOverride("ownMastodon", prepareMastodonHandleForInput);
    AutomaticSettings.Trigger.addCustomSaveOverride("ownMastodon", saveMastodonHandle);

    // register triggers
    AutomaticSettings.Trigger.registerSave("ownMastodon", checkMastodonHandle);

    AutomaticSettings.Trigger.registerUpdate("ownMastodon", checkMastodonHandleFast);

    // handle loading of options correctly
    AutomaticSettings.Trigger.registerAfterLoad(AutomaticSettings.Trigger.RUN_ALL_SAVE_TRIGGER);
}
