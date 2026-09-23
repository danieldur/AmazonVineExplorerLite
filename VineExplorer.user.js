// ==UserScript==
// @name         Amazon Vine Explorer Lite
// @namespace    https://github.com/danieldur/AmazonVineExplorerLite
// @version      0.12.1
// @updateURL    https://raw.githubusercontent.com/danieldur/AmazonVineExplorerLite/main/VineExplorer.user.js
// @downloadURL  https://raw.githubusercontent.com/danieldur/AmazonVineExplorerLite/main/VineExplorer.user.js
// @supportURL   https://github.com/danieldur/AmazonVineExplorerLite/issues
// @description  Better View, Search and Explore for Amazon Vine Products - Vine Voices Edition
// @author       MarkusSR1984, Christof121, Olum-hack, Deburau, adripo, danieldur
// @match        https://www.amazon.com/*
// @match        https://www.amazon.ca/*
// @match        https://www.amazon.co.uk/*
// @match        https://www.amazon.de/*
// @match        https://www.amazon.fr/*
// @match        https://www.amazon.it/*
// @match        https://www.amazon.es/*
// @match        https://www.amazon.co.jp/*
// @license      MIT
// @icon64       https://raw.githubusercontent.com/danieldur/AmazonVineExplorerLite/main/vine_logo.png
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @require      globals.js
// @require      i18n.js
// @require      class_db_handler.js
// @require      class_product.js
// @require      vine_fetch.js
// @require      https://raw.githubusercontent.com/eligrey/FileSaver.js/v2.0.4/src/FileSaver.js
// ==/UserScript==

'use strict';
console.log(`Init Vine Voices Explorer ${AVE_VERSION}`);

/**
 * On witch page are we atm ? PAGETYPE
 * @type {PAGETYPE}
 */
let currentMainPage;

// Translation wrapper with a fallback string for early-load timing.
const translate = (category, key, fallback, ...args) => typeof t === 'function' ? t(category, key, ...args) : fallback;

loadSettings();
fastStyleChanges();

let searchInputTimeout;

// Make some things accessable from console
unsafeWindow.ave = {
    classes: [
        DB_HANDLER
    ],
    config: SETTINGS,
    event: ave_eventhandler,
};

let database;
// Async bootstrap to avoid blocking document-start and to keep DB init isolated.
(async () => {
    try {
        database = await DB_HANDLER.init(DATABASE_NAME, DATABASE_OBJECT_STORE_NAME, DATABASE_VERSION);

        // Prevent duplicate initialization when multiple DOM targets appear.
        let _execLock = false;
        console.log('Lets Check where we are....');
        if (SITE_IS_VINE){
            console.log('We are on Amazon Vine'); // We are on the amazon vine site
            if(SETTINGS && SETTINGS.DarkMode){
                waitForHtmlElement('body', () => {
                    injectDarkMode();
                })
            }

            const urlParams = new URLSearchParams(window.location.search);
            const aveData = urlParams.get('vine-data');
            let aveShareData = localStorage.getItem('ave-share-details');
            if(aveData || aveShareData){
                let _data;
                try {
                    _data = aveShareData ? JSON.parse(aveShareData) : (aveData ? JSON.parse(aveData) : null);
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                    return;
                }
                waitForHtmlElement('body', () => {
                    let aveShareElementTmp = document.createElement('div');
                    aveShareElementTmp.style.display = "none";
                    aveShareElementTmp.innerHTML = `
                <span class="a-button a-button-primary vvp-details-btn" id="a-autoid-0">
                <span class="a-button-inner">
                <input data-asin="${_data.asin}" data-is-parent-asin="${_data.isParentAsin}" data-is-pre-release="${_data.data_is_pre_release ?? false}" data-recommendation-id="${_data.recommendationId}" data-recommendation-type="VENDOR_TARGETED" class="a-button-input" type="submit" aria-labelledby="a-autoid-0-announce">
                <span class="a-button-text" aria-hidden="true" id="a-autoid-0-announce">${translate('buttons', 'moreDetails', 'Weitere Details')}
                </span>
                </span>
                </span>
                `;
                    document.body.appendChild(aveShareElementTmp);
                    setTimeout(() => {
                        aveShareElementTmp.querySelector('input').click();
                        setTimeout(() => {
                            localStorage.removeItem('ave-share-details');
                        }, 200);
                    }, 500);
                })
            }
            addAveSettingsTab();
            addAVESettingsMenu();
            // Wait until tiles exist before initializing UI and page state.
            waitForHtmlElement('.vvp-details-btn', (elem) => {
                if (!elem) return;

                if (_execLock) return;

                _execLock = true;
                addBranding();
                detectCurrentPageType();
                let _tileCount = 0;
                const _initialWaitForAllTiles = setInterval(() => {
                    const _count = document.getElementsByClassName('vvp-details-btn').length;
                    if (_count > _tileCount) {
                        _tileCount = _count;
                    } else {
                        clearInterval(_initialWaitForAllTiles);
                        init(true);
                    }
                }, 100);
            });
            // Alternate init path for empty pages (no offers).
            waitForHtmlElement('.vvp-no-offers-msg', (elem) => { // Empty Page ?!?!
                if (!elem) return;

                if (_execLock) return;

                _execLock = true;
                if(SETTINGS.DarkMode){
                    waitForHtmlElement('body', () => {
                        injectDarkMode();
                    })
                }
                addBranding();
                init(false);
            });
        } else if (SITE_IS_SHOPPING) {
            console.log('We are on Amazon Shopping');
            _execLock = true;
            waitForHtmlElement('body', () => {
                addBranding();
            });
            useEnrollmentData();

            function useEnrollmentData() {
                const urlParams = new URLSearchParams(window.location.search);
                const aveData = urlParams.get('vine-data');
                if (aveData) {
                    let enrollmentData;
                    try {
                        enrollmentData = JSON.parse(decodeURIComponent(aveData));
                    } catch (error) {
                        console.error('Error parsing enrollment data:', error);
                        return;
                    }
                    localStorage.setItem('ave-share-details', JSON.stringify(enrollmentData));
                    window.open(`${window.location.origin}/vine/vine-items`, '_blank');
                }
            }
        }
    } catch (err) {
        console.error(`Something was going wrong while init database :'(`, err);
        return;
    }
})();

unsafeWindow.ave.database = database;

let oldCountOfNewItems = 0;

let showDbUpdateLogoTimeout = null;
let showDbUpdateLogoIcon = null;

let eventDelegationInitialized = false;

function initGlobalEventDelegation() {
    if (eventDelegationInitialized) return;
    
    document.body.addEventListener('click', (event) => {
        const tile = event.target.closest('.vvp-item-tile');
        if (!tile) return;

        const input = tile.querySelector('.vvp-details-btn input');
        const data = {};
        
        if (input) {
            data.asin = input.getAttribute('data-asin');
            data.parent_asin = input.getAttribute('data-is-parent-asin');
            data.recommendation_id = input.getAttribute('data-recommendation-id');
        } else {
            data.recommendation_id = tile.getAttribute('data-recommendation-id');
        }

        const taxElem = tile.querySelector('[id^="ave-taxinfo-"]');
        if (taxElem) data.tax = taxElem.textContent;

        if (event.target.classList.contains('ave-favorite-star')) {
            favStarEventhandlerClick(event, data);
            return;
        }

        if (event.target.classList.contains('ave-share')) {
            shareEventHandlerClick(event, data);
            return;
        }

        if (event.target.closest('.vvp-details-btn')) {
            btnEventhandlerClick(event, data);
            return;
        }
    });

    eventDelegationInitialized = true;
}

ave_eventhandler.on('ave-database-changed', () => {
    if (SETTINGS.DebugLevel > 1) console.info('EVENT - Database has new Data for us! we should look what has changed');
    updateNewProductsBtn();
    updateFavoritesBtn()

    if (showDbUpdateLogoTimeout) clearTimeout(showDbUpdateLogoTimeout);
    if (!showDbUpdateLogoIcon) showDbUpdateLogoIcon = addDBLoadingSymbol();

    showDbUpdateLogoTimeout = setTimeout(() => {
        if (showDbUpdateLogoIcon) showDbUpdateLogoIcon.remove();
        showDbUpdateLogoTimeout = null;
        showDbUpdateLogoIcon = null;
    }, 5000);
})

window.addEventListener('scroll', () => { 
    var _top = 5;
    stickElementToTopScrollEVhandler('ave-btn-allseen', `${_top}px`);
    _top = _top + 35;

    if(SETTINGS.EnableBtnMarkAllAsSeen) {
        stickElementToTopScrollEVhandler('ave-btn-db-allseen', `${_top}px`);
        _top = _top + 35;
    }

    stickElementToTopScrollEVhandler('ave-btn-backtotop', `${_top}px`);
}, { passive: true });

function injectDarkMode() {

    const _darkModeIgnoreBackgroundColor = `
    i,
    span.a-declarative *,
    #navbar-main *,
    #ave-btn-allseen *,
    #ave-btn-db-allseen *,
    #ave-btn-backtotop *,
    #ave-branding-text,
    #ave-brandig-text,
    .animated-progress *,
    .a-switch.a-declarative,
    .vvp-reviews-table--actions-col *,
    .a-tab-heading,
    .a-tab-heading a,
    .ave-favorite-star,
    .vvp-item-tile,
    .vvp-item-tile-content,
    .vvp-item-tile-content *,
    .a-popover-lgtbox,
    .a-modal-scroller.a-declarative,
    #ave-btn-favorites *,
    #ave-btn-list-new *,
    .ave-settings-label-switch *,
    .a-last *
    `
    const _darkModeIgnoreColor = `
    span.a-declarative *,
    #navbar-main *,
    #ave-btn-allseen *,
    #ave-btn-db-allseen *,
    #ave-btn-backtotop *,
    #ave-branding-text,
    #ave-brandig-text,
    .a-switch.a-declarative,
    .vvp-reviews-table--actions-col *,
    .vvp-details-btn *,
    .vvp-header-link *,
    .a-link-normal,
    #ave-btn-favorites *,
    #ave-btn-list-new *,
    .a-last *
    `

    const _darkModeIgnoreIcons = `
    #vvp-feedback-star-rating
    `

    const darkCSS = `
    :root{
      --primary-color: ${SETTINGS.DarkModeColor};
      --secondary-color: ${SETTINGS.DarkModeBackgroundColor};
    }

    .ave-color, .ave-color *:not(${_darkModeIgnoreColor}){
      color: var(--primary-color) !important;
    }
    .ave-background-color, .ave-background-color *:not(${_darkModeIgnoreBackgroundColor}){
      background-color: var(--secondary-color) !important;
    }
    .a-expander-content-fade,
    .a-popover-footer::before,
    .a-popover-wrapper::after
    {
      background: none !important;
    }
    i:not(${_darkModeIgnoreIcons}){
      background-color: transparent !important;
      filter: invert(1) !important;
    }
    `
    var styleElement = document.createElement('style');
    styleElement.type = 'text/css';
    styleElement.textContent = darkCSS;
    document.head.insertBefore(styleElement, document.head.firstChild);
    document.body.classList.add('ave-color','ave-background-color');
}

function getUrlParameter(name) {
    const _queryString = window.location.search;
    const _urlParams = new URLSearchParams(_queryString);
    return _urlParams.get(name);
}

/**
 * Detect the current Vine queue based on URL parameters.
 * Sets currentMainPage for downstream navigation logic.
 */
function detectCurrentPageType(){
    if (/http[s]{0,1}:\/\/[w]{0,3}.amazon.[a-z]{1,}.{0,1}[a-z]{0,}\/vine\/vine-items$/.test(window.location.href)) {
        currentMainPage = PAGETYPE.ORIGINAL_LAST_CHANCE;
    } else if (getUrlParameter('queue') == 'last_chance') {
        currentMainPage = PAGETYPE.ORIGINAL_LAST_CHANCE;
    } else if (getUrlParameter('queue') == 'potluck') {
        currentMainPage = PAGETYPE.OROGINAL_POTLUCK;
    } else if (getUrlParameter('queue') == 'encore') {
        currentMainPage = PAGETYPE.ORIGINAL_SELLER;
    }

}

/**
 * Parse tile metadata and sync with IndexedDB.
 * @param {Element} tile
 * @returns {Promise<Product>}
 */
async function parseTileData(tile) {
    const _id = tile.getAttribute('data-recommendation-id');
    const _ret = await database.getById(_id);

    if (_ret) {
        _ret.gotFromDB = true;
        _ret.ts_lastSeen = unixTimeStamp();
        _ret.notSeenCounter = 0;
        await database.update(_ret);
        return _ret;
    }

    const _isPrerelease = tile.querySelector('.vvp-badge-prerelease') !== null;
    const _isFeatured = tile.querySelector('.vvp-badge-featured') !== null;
    const _div_vpp_item_tile_content = tile.querySelector('.vvp-item-tile-content');
    
    if (!_div_vpp_item_tile_content) return null;

    const _img = _div_vpp_item_tile_content.querySelector('img');
    const _title_container = _div_vpp_item_tile_content.querySelector('.vvp-item-product-title-container');
    const _input = _div_vpp_item_tile_content.querySelector('.a-button-inner input');

    const _newProduct = new Product(_id);
    _newProduct.data_recommendation_id = _id;
    _newProduct.data_img_url = tile.getAttribute('data-img-url');
    _newProduct.data_img_alt = _img ? (_img.getAttribute('alt') || "") : "";
    _newProduct.data_is_featured = _isFeatured;

    if (!_isPrerelease && _title_container) {
        const aTag = _title_container.querySelector('a');
        if (aTag) _newProduct.link = aTag.getAttribute('href');
    }

    if (_title_container) {
        const fullDesc = _title_container.querySelector('.a-truncate-full');
        const shortDesc = _title_container.querySelector('.a-truncate-cut');
        _newProduct.description_full = fullDesc ? fullDesc.textContent : "";
        _newProduct.description_short = shortDesc ? shortDesc.textContent : "";
    }

    if (_input) {
        _newProduct.data_asin = _input.getAttribute('data-asin');
        _newProduct.data_recommendation_type = _input.getAttribute('data-recommendation-type');
        _newProduct.data_asin_is_parent = (_input.getAttribute('data-is-parent-asin') === 'true');
        _newProduct.data_is_pre_release = (_input.getAttribute('data-is-pre-release') === 'true');
    }

    if (!_newProduct.description_short || _newProduct.description_short.trim() === '') {
        _newProduct.description_short = `${_newProduct.description_full.substr(0,50)}...`;
        _newProduct.generated_short = true;
    } 

    return _newProduct;
}

function reloadPageWithSubpageTarget(target) {
    if (window.location.href.includes('?')) {
        window.location.href = window.location.href + `&ave-subpage=${target}`;
    } else {
        window.location.href = window.location.href + `?ave-subpage=${target}`;
    }
}

function addLeftSideButtons(forceClean) {
    const _nodesContainer = document.getElementById('vvp-browse-nodes-container');
    if (!_nodesContainer) return;

    if (forceClean) _nodesContainer.innerHTML = '';

    const _div = _nodesContainer.appendChild(document.createElement('div'));
    _div.setAttribute('class', 'parent-node');

    _div.appendChild(document.createElement('p')); // A bit of Space above our Buttons

    const _setAllSeenBtn = createButton(translate('buttons', 'markPageAsSeen', 'Seite als gesehen markieren'),'ave-btn-allseen',  `width: 240px; background-color: ${SETTINGS.BtnColorMarkCurrSiteAsSeen};`, () => {

        if (SETTINGS.DebugLevel > 10) console.log('Clicked All Seen Button');
        markAllCurrentSiteProductsAsSeen();
        window.scrollTo(0, 0);
    });
    _div.appendChild(_setAllSeenBtn);

    if(SETTINGS.EnableBtnMarkAllAsSeen) {
        const _setAllSeenDBBtn = createButton(translate('buttons', 'markAllAsSeen', 'Alle als gesehen markieren'),'ave-btn-db-allseen', `left: 0; width: 240px; background-color: ${SETTINGS.BtnColorMarkAllAsSeen};`, () => {

            if (SETTINGS.DebugLevel > 10) console.log('Clicked All Seen Button');
            setTimeout(() => {
                database.getNewEntries().then((prodsArr) => {
                    const _prodsArryLength = prodsArr.length;
                    for (let i = 0; i < _prodsArryLength; i++) {
                        const _currProd = prodsArr[i];
                        if (_currProd.isNew) {
                            _currProd.isNew = 0;
                            database.update(_currProd);
                        }
                    }
                })
            }, 30);
        });
        _div.appendChild(_setAllSeenDBBtn);
    }

    const _backToTopBtn = createButton(translate('buttons', 'backToTop', 'Zum Seitenanfang'),'ave-btn-backtotop',  `width: 240px; background-color: ${SETTINGS.BtnColorBackToTop};`, () => {

        if (SETTINGS.DebugLevel > 10) console.log('Clicked back to Top Button');
        window.scrollTo(0, 0);
    });
    _div.appendChild(_backToTopBtn);
}

async function markAllCurrentSiteProductsAsSeen(cb = () => {}) {
    const _tiles = Array.from(document.getElementsByClassName('vvp-item-tile'));
    
    await Promise.all(_tiles.map(async (_tile) => {
        const _id = _tile.getAttribute('data-recommendation-id');
        const prod = await database.getById(_id);
        if (prod) {
            prod.isNew = 0;
            await database.update(prod);
            updateTileStyle(prod);
        }
    }));
    
    cb();
}

async function markAllCurrentDatabaseProductsAsSeen(cb = () => {}) {
    if (SETTINGS.DebugLevel > 10) console.log('Called markAllCurrentDatabaseProductsAsSeen()');
    const prods = await database.getNewEntries();
    
    if (prods.length === 0) {
        cb(true);
        return;
    }

    await Promise.all(prods.map(async (_currProd) => {
        _currProd.isNew = 0;
        await database.update(_currProd);
    }));

    cb(true);
}

function createButton(text, id, style, clickHandler){
    const _btnSpan = document.createElement('span');
    _btnSpan.setAttribute('id', id);
    _btnSpan.setAttribute('class', 'a-button a-button-normal a-button-toggle');
    _btnSpan.setAttribute('aria-checked', 'true');
    _btnSpan.style.marginLeft = '0';
    _btnSpan.style.marginTop = '5px';
    _btnSpan.innerHTML = `
        <span class="a-button-inner" style="${style || ''}">
            <span class="a-button-text">${text}</span>
        </span>
    `;
    _btnSpan.addEventListener('click', (ev) => {
        if (clickHandler) {
            clickHandler(ev);
        } else {
            alert(translate('notifications', 'nothingToSee', 'Hier gibt es nix zu sehen.\nZumindest noch nicht :P'));
        }
    });
    return _btnSpan;
}

async function createTileFromProduct(product, btnID, cb) {
    if (!product && SETTINGS.DebugLevel > 10) console.error(`createTileFromProduct got no valid product element`);
    return new Promise((resolve, _reject) => {
        const _btnAutoID = btnID || Math.round(Math.random() * 10000);

        const _tile = document.createElement('div');
        _tile.setAttribute('class', 'vvp-item-tile');
        _tile.setAttribute('data-recommendation-id', product.data_recommendation_id);
        _tile.setAttribute('data-img-url', fixProductImageUrl(product.data_img_url));
        _tile.setAttribute('style', (product.notSeenCounter > 0) ? SETTINGS.CssProductRemovalTag : (product.isFav) ? SETTINGS.CssProductNewTag : (product.isNew) ? SETTINGS.CssProductNewTag : SETTINGS.CssProductDefault);
        const _spanTruncateHtml = `
            <span class="a-truncate" data-a-word-break="normal" data-a-max-rows="2" data-a-overflow-marker="&amp;hellip;" style="line-height: 1.3em !important; max-height: 2.6em;" data-a-recalculate="false" data-a-updated="true">
                <span class="a-truncate-full a-offscreen">${product.description_full}</span>
                <span class="a-truncate-cut" aria-hidden="true" style="height: 2.6em;">${product.description_short}</span>
            </span>
        `;
        const _itemProductTitleContainerHtml = product.link ? `
            <a class="a-link-normal" target="_blank" rel="noopener" href="${product.link}">
                ${_spanTruncateHtml}
            </a>
        ` : _spanTruncateHtml;
        var _itemBadgesHtml = '';
        if (product.data_is_pre_release || product.data_is_featured) {
            _itemBadgesHtml += '<div class="vvp-item-badges" style="margin-top: 20px;">';
            if (product.data_is_pre_release) {
                _itemBadgesHtml += `<span class="vvp-badge-prerelease">${translate('badges', 'preRelease', 'Vorabversion')}</span>`;
            }
            if (product.data_is_featured) {
                _itemBadgesHtml += `<span class="vvp-badge-featured">${translate('badges', 'featured', 'Empfohlen')}</span>`;
            }
            _itemBadgesHtml += '</div>';
        }
        _tile.innerHTML =`
            <div class="vvp-item-tile-content">
                ${_itemBadgesHtml}
                <img alt="${product.data_img_alt}" src="${fixProductImageUrl(product.data_img_url)}">
                <div class="vvp-item-product-title-container">
                    ${_itemProductTitleContainerHtml}
                </div>
                <span class="a-button a-button-primary vvp-details-btn" id="a-autoid-${_btnAutoID}">
                    <span class="a-button-inner">
                        <input data-asin="${product.data_asin}" data-is-parent-asin="${product.data_asin_is_parent}" data-is-pre-release="${product.data_is_pre_release ?? false}" data-recommendation-id="${product.data_recommendation_id}" data-recommendation-type="${product.data_recommendation_type}" class="a-button-input" type="submit" aria-labelledby="a-autoid-${_btnAutoID}-announce">
                        <span class="a-button-text" aria-hidden="true" id="a-autoid-${_btnAutoID}-announce">${translate('buttons', 'moreDetails', 'Weitere Details')}</span>
                    </span>
                </span>
            </div>
        `;
        _tile.prepend(createFavStarElement(product, btnID));
        _tile.prepend(createTimeSeenElement(product, btnID));
        _tile.prepend(createShareElement(product, btnID));
        waitForHtmlElement('.vvp-item-product-title-container', (_elem) => {
            if (!_elem) return;

            insertHtmlElementAfter(_elem, createTaxInfoElement(product, btnID));
        }, _tile)
        if (cb) cb(_tile);
        resolve(_tile);
    })
}

function createFavStarElement(prod, index = Math.round(Math.random()* 10000)) {
    const _favElement = document.createElement('div');
    _favElement.setAttribute("id", `p-fav-${index || Math.round(Math.random() * 5000)}`);
    _favElement.classList.add('ave-favorite-star');
    _favElement.style.cssText = SETTINGS.CssProductFavStar();
    _favElement.textContent = '★';
    if (prod.isFav) _favElement.style.color = SETTINGS.FavStarColorChecked; 
    return _favElement;
}

function createFirstSeenElement(prod, index = Math.round(Math.random()* 10000)) {
    return createTimeSeenElement(prod, index, true);
}

function createTimeSeenElement(prod, index = Math.round(Math.random()* 10000), showFirstSeen) {
    const _showFirstSeen = showFirstSeen === false || showFirstSeen === true ? showFirstSeen : SETTINGS.ShowFirstSeen || false;

    const _timeSeenElement = document.createElement('div');
    _timeSeenElement.setAttribute("id", `ave-p-timeSeen-${index || Math.round(Math.random() * 5000)}`);
    _timeSeenElement.classList.add('ave-last-seen');
    if (_showFirstSeen) {
        _timeSeenElement.textContent = 'First seen: ' + timeAgo(new Date(toTimestamp(prod.ts_firstSeen)));
    } else {
        _timeSeenElement.textContent = 'Last seen: ' + timeAgo(new Date(toTimestamp(prod.ts_lastSeen)));
    }
    _timeSeenElement.style.float = 'left';
    _timeSeenElement.style.display = 'flex';
    return _timeSeenElement;
}

function timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    const interval = Math.floor(seconds / 31536000);

    if (interval > 1) {
        return interval + " years ago";
    }
    if (interval === 1) {
        return interval + " year ago";
    }

    const months = Math.floor(seconds / 2628000);
    if (months > 1) {
        return months + " months ago";
    }
    if (months === 1) {
        return months + " month ago";
    }

    const days = Math.floor(seconds / 86400);
    if (days > 1) {
        return days + " days ago";
    }
    if (days === 1) {
        return days + " day ago";
    }

    const hours = Math.floor(seconds / 3600);
    if (hours > 1) {
        return hours + " hours ago";
    }
    if (hours === 1) {
        return hours + " hour ago";
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes > 1) {
        return minutes + " minutes ago";
    }
    if (minutes === 1) {
        return minutes + " minute ago";
    }

    return "just now";
}

function createShareElement(prod, index = Math.round(Math.random()* 10000)) {
    const _shareElement = document.createElement('div');
    _shareElement.setAttribute("id", `ave-p-share-${index || Math.round(Math.random() * 5000)}`);
    _shareElement.classList.add('ave-share');
    _shareElement.textContent = '🔗';
    _shareElement.style.float = 'left';
    _shareElement.style.display = 'flex';
    _shareElement.style.margin = '0';
    _shareElement.style.cursor = 'pointer';
    return _shareElement;
}

function shareEventHandlerClick(event, _data){
    if(_data.recommendation_id){
        if (SETTINGS.DebugLevel > 1) console.log("[AVE]",_data);
        const newUrl = `${window.location.origin}/dp/${_data.asin}?vine-data=${encodeURIComponent(JSON.stringify({
            asin: _data.asin,
            isParentAsin: _data.parent_asin,
            recommendationId: _data.recommendation_id,
            tax: _data.tax,
        }))}`;


        const urlParams = new URLSearchParams(window.location.search);
        let queueParam = currentMainPage;
        let pageParam = urlParams.get('page');
        if(pageParam == null){pageParam = 1}
        let page = ""

        switch(queueParam){
            case PAGETYPE.OROGINAL_POTLUCK:
                queueParam = translate('share', 'myFSE', 'Mein FSE')
                page = `${translate('share', 'page', 'Seite:')} ${pageParam}`
                break;
            case PAGETYPE.ORIGINAL_LAST_CHANCE:
                queueParam = translate('share', 'availableAll', 'Verfügbar für Alle')
                page = `${translate('share', 'page', 'Seite:')} ${pageParam}`
                break;
            case PAGETYPE.ORIGINAL_SELLER:
                queueParam = translate('share', 'additional', 'Zusätzliche Artikel')
                page = `${translate('share', 'page', 'Seite:')} ${pageParam}`
                break;
            default:
                queueParam = ""
                page = ``
                break;

        }

        let shareText = `
${queueParam}
${page}
${_data.tax}

${newUrl}`

        const inputRect = event.target.getBoundingClientRect();

        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;

        let avePopup = document.createElement('div');
        avePopup.style.position = 'absolute';
        avePopup.style.zIndex = '9999';
        avePopup.style.padding = '5px'
        avePopup.style.top = `${inputRect.top + scrollY}px`;
        avePopup.style.left = `${inputRect.left + scrollX}px`;
        avePopup.style.border = '5px solid black';
        avePopup.style.borderRadius = '100vh';
        avePopup.style.backgroundColor = 'white'
        avePopup.style.transform = 'translate(-50%, -100%)'
        avePopup.style.opacity = '0';
        avePopup.style.transition = "opacity 0.2s ease-in-out";

        navigator.clipboard.writeText(shareText).then(() => {
            avePopup.innerText = translate('notifications', 'copySuccess', 'Text wurde in die Zwischenablage kopiert.');
        }).catch(err => {
            avePopup.innerText = `${translate('notifications', 'copyError', 'Fehler beim Kopieren in die Zwischenablage:')}${err}`;
        });

        document.body.appendChild(avePopup);

        setTimeout(()=> {
            avePopup.style.opacity = '1';
        }, 0);

        setTimeout(()=> {
            avePopup.style.opacity = '0';
            setTimeout(()=> {
                avePopup.remove();
            }, 200);
        }, 3500);

    }
}

function createTaxInfoElement(prod, index = Math.round(Math.random()* 10000)) {
    if (SETTINGS.DebugLevel > 10) ('Called createTaxInfo()');
    let _currencySymbol = '';
    if (prod.data_tax_currency && prod.data_tax_currency == 'EUR') _currencySymbol = '€';

    const _taxElement = document.createElement('span');
    _taxElement.setAttribute("id", `ave-taxinfo-${index}`);
    _taxElement.style.cssText = 'position: relative; transform: translate(0px, -30px); width: fit-content; right: 0px;';

    const _taxElement_span = document.createElement('span');
    _taxElement_span.setAttribute("id", `ave-taxinfo-${index}-text`);
    _taxElement_span.classList.add('ave-taxinfo-text');
    const _prize = prod.data_estimated_tax_prize;
    if (SETTINGS.DebugLevel > 10) console.log('Called createTaxInfo(): We have a Taxprize of: ', _prize);
    _taxElement_span.innerText = `Tax Price: ${(typeof(_prize) == 'number') ? Intl.NumberFormat(undefined, {minimumFractionDigits: 2}).format(_prize) : '--.--'} ${_currencySymbol}`;
    if (SETTINGS.DebugLevel > 10) console.log('createTaxInfo(): After innerText');

    _taxElement.appendChild(_taxElement_span);
    if (SETTINGS.DebugLevel > 10) console.log('createTaxInfo(): END', _taxElement);
    return _taxElement;
}

function insertHtmlElementAfter(referenceNode, newNode) {
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}

async function createProductSite(siteType, productArray, cb) {
    if (!productArray) return;

    const _showFirstSeen = SETTINGS.ShowFirstSeen || false;
    productArray = sort_by_key(productArray, _showFirstSeen ? 'ts_firstSeen' : 'ts_lastSeen');

    const _productArrayLength = productArray.length;
    const _fastCount = Math.min(_productArrayLength, SETTINGS.MaxItemsPerPage);
    if (SETTINGS.DebugLevel > 10) console.log(`Create Overview for ${_productArrayLength} Products`);

    const _paginations = document.querySelectorAll('.a-pagination');
    _paginations.forEach(_pagination => {
        _pagination.remove();
    });

    const _contentContainer = document.querySelector('.a-section.vvp-tab-content');
    if(_contentContainer.querySelector('.vvp-no-offers-msg')){
        _contentContainer.querySelector('.vvp-no-offers-msg').remove();
        let _tileStructure = document.createElement('div');
        _tileStructure.classList = 'a-section vvp-items-container';
        _tileStructure.innerHTML = `
        <div id="vvp-browse-nodes-container">
        </div>
        <div id="vvp-items-grid-container">
        <p>
        </p>
        <div id="vvp-items-grid" class="a-section">
        </div>
        </div>`;

        _contentContainer.appendChild(_tileStructure);
    };

    const _nodesContainer = document.getElementById('vvp-browse-nodes-container');
    if (_nodesContainer) _nodesContainer.innerHTML = '';

    const _tilesContainer = document.getElementById('vvp-items-grid-container');
    if (!_tilesContainer) reloadPageWithSubpageTarget(siteType);

    if (_tilesContainer) {
        const _topLine = _tilesContainer.getElementsByTagName('p')[0];
        _topLine.innerHTML = `<p>Anzeigen von <strong>${_fastCount}</strong> von <strong>${_productArrayLength}</strong> Ergebnissen</p>`
    }

    const _tilesGrid = document.getElementById('vvp-items-grid');
    if (!_tilesGrid) reloadPageWithSubpageTarget(siteType);
    _tilesGrid.innerHTML = '';

    let _index = 0;
    let _returned = 0;

    for (; _index < _fastCount; _index++) {
        createTileFromProduct(productArray[_index], _index, (tile) => {
            _tilesGrid.append(tile);
            _returned++;
            if (SETTINGS.DebugLevel > 10) console.log(`Created Tile (${_returned}/${_fastCount})`);
            if (_returned == _fastCount) cb(true);
        });
    }

    addLeftSideButtons(true);
}

/**
 * AVE PAGETYPE ENUM
 * @readonly
 * @enum {number}
 */
const PAGETYPE = {
    NEW_ITEMS: 0,
    FAVORITES: 1,
    SEARCH_RESULT: 9,

    OROGINAL_POTLUCK: 100,
    ORIGINAL_LAST_CHANCE: 101,
    ORIGINAL_SELLER: 102
}

function createNewSite(type, data) {
    const _btnContainer = document.getElementById('vvp-items-button-container');
    const _selected = _btnContainer.getElementsByClassName('a-button-selected');
    for (let i = 0; i < _selected.length; i++) {
        const _btn = _selected[i];
        _btn.classList.remove("a-button-selected");
        _btn.classList.add("a-button-normal");
        _btn.removeAttribute('aria-checked');
    }

    switch(type) {
        case PAGETYPE.NEW_ITEMS:{
            currentMainPage = PAGETYPE.NEW_ITEMS;
            database.getNewEntries().then((_prodArr) => {
                createProductSite(type, _prodArr, () => {
                    const _btn = document.getElementById('ave-btn-list-new');
                    _btn.classList.add('a-button-selected');
                    _btn.setAttribute('aria-checked', true);
                });
            })
            break;
        }
        case PAGETYPE.FAVORITES:{
            currentMainPage = PAGETYPE.FAVORITES;
            database.getFavEntries().then((_prodArr) => {
                createProductSite(type, _prodArr, () => {
                    const _btn = document.getElementById('ave-btn-favorites');
                    _btn.classList.add('a-button-selected');
                    _btn.setAttribute('aria-checked', true);
                });
            })
            break;
        }
        case PAGETYPE.SEARCH_RESULT:{
            currentMainPage = PAGETYPE.SEARCH_RESULT;
            createProductSite(type, data, () => {
            });
            break;
        }
    }
}

let lastBtnEventhandlerClickTimeStamp = 0;
function btnEventhandlerClick(event, data) {
    if (lastBtnEventhandlerClickTimeStamp + 1000 >= Date.now()) return;
    lastBtnEventhandlerClickTimeStamp = Date.now();
    if (SETTINGS.DebugLevel > 10) console.log(`called btnEventhandlerClick(${JSON.stringify(event)}, ${JSON.stringify(data)})`);
    if (data.recommendation_id) {
        database.getById(data.recommendation_id).then(async (prod) => {
            if (SETTINGS.DebugLevel > 10) console.log(`btnEventhandlerClick() got respose from DB:`, prod);
            if (prod) {
                prod.isNew = 0;
                requestProductDetails(prod).then((_newProd) => {
                    database.update(_newProd || prod).then( () => {
                        updateTileStyle(_newProd || prod);
                    });
                })
            }
        })
    }
}

function favStarEventhandlerClick(event, data) {
    if (SETTINGS.DebugLevel > 10) console.log(`called favStarEventhandlerClick(${JSON.stringify(event)}, ${JSON.stringify(data)})`);
    if (data.recommendation_id) {
        database.getById(data.recommendation_id).then((prod) => {
            if (SETTINGS.DebugLevel > 10) console.log(`favStarEventhandlerClick() got respose from DB:`, prod);
            if (prod) {
                prod.isFav = 1 - prod.isFav;
                database.update(prod).then(() => {
                    updateTileStyle(prod);
                });
            }
        })
    }
}

/**
 * Updates Style and Text of a Product Tile
 * @param {Product} prod
 * @returns
 */
function updateTileStyle(prod) {
    const _tile = document.querySelector(`.vvp-item-tile[data-recommendation-id="${prod.data_recommendation_id}"]`);
    if (!_tile) return;

    _tile.setAttribute('style', (prod.isFav) ? SETTINGS.CssProductFavTag : (prod.isNew) ? SETTINGS.CssProductNewTag : SETTINGS.CssProductDefault);
    
    const _favStar = _tile.querySelector('.ave-favorite-star');
    if (_favStar) _favStar.style.color = (prod.isFav) ? SETTINGS.FavStarColorChecked : 'white';

    const _taxValue = prod.data_estimated_tax_prize;
    if (typeof (_taxValue) === 'number') {
        const _taxValueElem = _tile.querySelector('.ave-taxinfo-text');
        if (_taxValueElem) {
            _taxValueElem.innerText = (_taxValueElem.innerText).replace('--.--', _taxValue);
        }
    }
}

function showAutoScanScreen(text) {
    const _overlay = document.createElement('div');
    _overlay.style.position = 'fixed';
    _overlay.style.top = '0';
    _overlay.style.left = '0';
    _overlay.style.width = '100%';
    _overlay.style.height = '100%';
    _overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    _overlay.style.zIndex = '1000'; 

    const _text = document.createElement('div');
    _text.style.position = 'absolute';
    _text.style.top = '50%';
    _text.style.left = '50%';
    _text.style.transform = 'translate(-50%, -50%)';
    _text.style.color = 'orange';
    _text.style.textAlign = 'center';
    _text.style.fontSize = '50px'; 
    _text.style.lineHeight = "1";
    _text.style.zIndex = '1001';
    const _autoScanText = document.getElementById('ave-autoscan-text');
    if (!_autoScanText) {
        _text.innerHTML = `<p id="ave-autoscan-text">${text}</p>`;
    } else {
        _autoScanText.textContent = text;
    }

    document.body.appendChild(_overlay);
    document.body.appendChild(_text);
}

function updateAutoScanScreenText(text = '') {
    const _elem = document.getElementById('ave-autoscan-text');
    _elem.textContent = text;
}

function populateSettingsContainer() {
    const _settingsContent = document.body.querySelector('[data-a-name="ave-settings"]');
    if (!_settingsContent) return;
    const _settingsContainer = _settingsContent.querySelector('#ave-settings-container');
    if (!_settingsContainer) return;
    if (_settingsContainer.getAttribute('data-ave-populated') === '1') return;

    _settingsContainer.innerHTML = '';
    for (const elem of SETTINGS_USERCONFIG_DEFINES) {
        if (SETTINGS.DebugLevel > 1) console.log('Creating Settings Menu Element: ', elem);
        _settingsContainer.appendChild(createSettingsMenuElement(elem));
    }
    _settingsContainer.setAttribute('data-ave-populated', '1');
}

function addAveSettingsTab(){
    waitForHtmlElement('.vvp-tab-set-container > ul', (_upperButtonsContainer) => {
        if (!_upperButtonsContainer) return;

        const _upperSettingsButton = document.createElement('li');
        _upperSettingsButton.id = 'vvp-ave-settings-tab';
        _upperSettingsButton.classList = 'a-tab-heading';
        _upperSettingsButton.role = 'presentation';
        _upperSettingsButton.innerHTML += `<a role="tab" aria-selected="false" tabindex="-1">${translate('buttons', 'settingsTab', 'AVE Einstellungen')}</a>`;

        _upperSettingsButton.addEventListener('click',function(){
            const _upperButtons = document.body.querySelectorAll('.a-tab-container.vvp-tab-set-container > ul > li');
            _upperButtons.forEach(element => element.classList.remove('a-active'));

            const _contentContainer = document.body.querySelectorAll('.a-tab-container.vvp-tab-set-container > div');
            _contentContainer.forEach(element => element.classList.add('a-hidden'));
            if (SETTINGS.DebugLevel > 1) console.log(_contentContainer);

            _upperSettingsButton.classList.add('a-active');
            const _settingsContent = document.body.querySelector('[data-a-name="ave-settings"]');
            _settingsContent.classList.remove('a-hidden');

            populateSettingsContainer();

        });

        _upperButtonsContainer.appendChild(_upperSettingsButton);
    })
}

function addAVESettingsMenu(){
    waitForHtmlElement('.a-tab-container.vvp-tab-set-container', (_tabContainer) => {
        if (!_tabContainer) return;

        const _boxContainer = document.createElement('div');
        _boxContainer.setAttribute('data-a-name', 'ave-settings');
        _boxContainer.classList = 'a-box a-box-tab a-tab-content a-hidden';
        _boxContainer.role = 'tabpanel';
        _boxContainer.tabindex = '0';

        const _contentContainer = document.createElement('div');
        _contentContainer.classList = 'a-box-inner'

        _boxContainer.appendChild(_contentContainer);
        _tabContainer.appendChild(_boxContainer);

        if (localStorage.getItem('AVE_OPEN_SETTINGS_TAB') === '1') {
            localStorage.removeItem('AVE_OPEN_SETTINGS_TAB');
            waitForHtmlElement('#vvp-ave-settings-tab', (_settingsTab) => {
                if (_settingsTab) {
                    _settingsTab.click();
                }
            });
        }

        _contentContainer.innerHTML = `
    <style>
    :root {
  --toggleSliderSize: 1;
  --numberBorder: 1px;
  --numberPadding: 2px;
  --itemHeight: 21px;
}
.ave-settings-container {
  display: grid;
}

.ave-settings-container label {
  padding: 0;
}

.ave-settings-container input[type="number"] {
  width: 75px;
  height: 21px;
  border: var(--numberBorder) solid #888C8C;
  padding: var(--numberPadding);
}

.ave-settings-container input[type="color"] {
  width: 30px;
  padding: 0;
  border: 1px solid darkgrey;
  border-radius: 6px;
  cursor: pointer;
  height: var(--itemHeight);
}

.ave-settings-container input[type="text"] {
  width: 500px;
}

.ave-settings-item{
  display: inline-flex;
  align-items: center;
  margin: 5px 0;
  height: var(--itemHeight);
}

.ave-item-left {
  display: flex;
  align-items: center;
  justify-content: center;
}

.ave-settings-item > * >.ave-settings-label-setting {
  margin-left: 5px;
}

.ave-settings-item > * >.ave-settings-label-setting:hover{
  color: red;
}

[data-ave-tooltip] {
  position: relative;
  z-index: 2;
  cursor: pointer;
}

[data-ave-tooltip]:before,
[data-ave-tooltip]:after {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

[data-ave-tooltip]:before {
  position: absolute;
  bottom: -50%;
  margin-bottom: 5px;
  margin-left: calc(100% + 10px);
  padding: 7px;
  width: 160px;
  -webkit-border-radius: 3px;
  -moz-border-radius: 3px;
  border-radius: 3px;
  background-color: hsla(0, 0%, 20%, 0.9);
  color: #fff;
  content: attr(data-ave-tooltip);
  text-align: center;
  font-size: 14px;
  line-height: 1.2;
}

[data-ave-tooltip]:after {
  position: absolute;
  bottom: 25%;
  margin-left: calc(0% + 5px);
  width: 0;
  border-right: 5px solid hsla(0, 0%, 20%, 0.9);
  border-bottom: 5px solid transparent;
  border-top: 5px solid transparent;
  content: " ";
  font-size: 0;
  line-height: 0;
}

[data-ave-tooltip]:hover:before,
[data-ave-tooltip]:hover:after,
[data-ave-tooltip]:focus-within:before,
[data-ave-tooltip]:focus-within:after{
  visibility: visible;
  opacity: 1;
}

.ave-settings-label-switch{
  position: relative;
  display: inline-block;
  width: calc(var(--toggleSliderSize) * 30px);
  height: calc(var(--toggleSliderSize) * 17px);
}

.ave-settings-switch-toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: 0.4s;
  border-radius: calc(var(--toggleSliderSize) * 17px);
}

.ave-settings-switch-toggle-slider:before{
  position: absolute;
  content: "";
  height: calc(var(--toggleSliderSize) * 13px);
  width: calc(var(--toggleSliderSize) * 13px);
  left: calc(var(--toggleSliderSize) * 2px);
  bottom: calc(var(--toggleSliderSize) * 2px);
  background-color: white;
  transition: 0.4s;
  border-radius: 50%;
}

input:checked + .ave-settings-switch-toggle-slider {
  background-color: #2196F3;
}

input:checked + .ave-settings-switch-toggle-slider:before {
  transform: translateX(calc(var(--toggleSliderSize) * 13px));
}

.ave-settings-label-switch input{
  display: none
}

.ave-keyword-wrapper {
  margin: 25px 0;
}

.ave-keyword-input {
  width: fit-content;
}

.ave-keyword-input button {
font-weight: bold;
}

.ave-keyword-list-wrapper {
  margin-top: 10px;
}

.ave-keyword-list-wrapper table {
  border-collapse: collapse;
  width: 500px;
}

.ave-keyword-list-wrapper > table td {
  border: 1px solid #000000;
  text-align: left;
  padding: 8px;
}

.ave-keyword-list-wrapper > table td:first-child {
  width: 25px;
  text-align: center;
  vertical-align: middle;
}

.ave-keyword-list-wrapper > table tr:nth-child(even) {
  background-color: #dddddd;
}

.ave-keyword-list-wrapper #list-delete {
  width: 75px;
  text-align: center;
}

.ave-keyword-list-wrapper > table button {
  display: flex;
  margin: auto;
  background-color: inherit;
  border: none;
}

.ave-input-button {
  border: none;
  background: none;
  margin: 3px;
}

::-webkit-color-swatch-wrapper {
  padding: 0;
}

::-webkit-color-swatch{
  border: 0;
  border-radius: 5px;
}

::-moz-color-swatch,
::-moz-focus-inner{
  border: 0;
}

::-moz-focus-inner{
  padding: 0;
}
    </style>

    <div id="ave-settings-header" style="margin-bottom: 10px"><h3>${translate('settings', 'header', `Einstellungen ${AVE_TITLE} - Version ${AVE_VERSION}`, AVE_TITLE, AVE_VERSION)}</h3></div>
    <div id="ave-settings-container" class="ave-settings-container">


</div>
    `;

        waitForHtmlElement('#ave-settings-container', () => {
            populateSettingsContainer();
        }, _contentContainer);
    })
}

function createSettingsMenuElement(dat){
    const _labelKey = dat.key || dat.name;
    const _labelName = translate('settingsLabels', _labelKey, dat.name || '');
    const _labelDescription = translate('settingsDescriptions', _labelKey, dat.description || _labelName || '');
    const _inputPlaceholder = dat.inputPlaceholder
        ? translate('settingsPlaceholders', _labelKey, dat.inputPlaceholder)
        : '';

    const _elem = document.createElement('div');
    if (dat.key) _elem.setAttribute('ave-config-key', dat.key);
    _elem.classList.add('ave-settings-item');

    if (dat.type == 'bool') {

        const _elem_item_left = document.createElement('div');
        _elem_item_left.classList.add('ave-item-left');
        const _elem_item_left_label = document.createElement('label');
        _elem_item_left_label.classList.add('ave-settings-label-switch');
        const _elem_item_left_label_input = document.createElement('input');
        _elem_item_left_label_input.type = 'checkbox';
        _elem_item_left_label_input.className = 'ave-input-binary';
        _elem_item_left_label_input.setAttribute('ave-data-key', dat.key);
        _elem_item_left_label_input.checked = SETTINGS[dat.key];
        _elem_item_left_label_input.addEventListener('click', (event) => {console.log('This is a Boolean Value Input', event); SETTINGS[dat.key] = event.target.checked; SETTINGS.save();})

        const _elem_item_left_label_span = document.createElement('span');
        _elem_item_left_label_span.classList.add('ave-settings-switch-toggle-slider');

        _elem_item_left_label.appendChild(_elem_item_left_label_input);
        _elem_item_left_label.appendChild(_elem_item_left_label_span);
        _elem_item_left.appendChild(_elem_item_left_label);
        _elem.appendChild(_elem_item_left);

        const _elem_item_right = document.createElement('div');
        _elem_item_right.classList.add('ave-item-right');
        _elem_item_right.innerHTML = `<label class="ave-settings-label-setting" data-ave-tooltip="${_labelDescription}">${_labelName}</label>`

        _elem.appendChild(_elem_item_right);

    } else if (dat.type == 'password') {

        const _elem_item_left = document.createElement('div');
        _elem_item_left.classList.add('ave-item-left');
        const _elem_item_left_input = document.createElement('input');
        _elem_item_left_input.type = 'password';
        _elem_item_left_input.className = 'ave-input-number';
        _elem_item_left_input.style.width = '300px';
        _elem_item_left_input.setAttribute('ave-data-key', dat.key);
        _elem_item_left_input.setAttribute('value', SETTINGS[dat.key]);
        _elem_item_left_input.addEventListener('change', (event) => {
            console.log('This is a Password Value Input', event);
            SETTINGS[dat.key] = event.target.value;
            SETTINGS.save();

        })
        _elem_item_left.appendChild(_elem_item_left_input);
        _elem.appendChild(_elem_item_left);

        const _elem_item_right = document.createElement('div');
        _elem_item_right.classList.add('ave-item-right');
        _elem_item_right.innerHTML = `<label class="ave-settings-label-setting" data-ave-tooltip="${_labelDescription}">${_labelName}</label>`

        _elem.appendChild(_elem_item_right);

    } else if (dat.type == 'url') { 

        const _elem_item_left = document.createElement('div');
        _elem_item_left.classList.add('ave-item-left');
        const _elem_item_left_input = document.createElement('input');
        _elem_item_left_input.type = 'url';
        _elem_item_left_input.className = 'ave-input-number';
        _elem_item_left_input.style.width = '300px';
        _elem_item_left_input.setAttribute('ave-data-key', dat.key);
        _elem_item_left_input.setAttribute('value', SETTINGS[dat.key]);
        _elem_item_left_input.addEventListener('change', (event) => {
            console.log('This is a URL Value Input', event);

            let _url = event.target.value;
            if (_url.length > 0) {
                if (!_url.endsWith('/')) _url = _url + '/';
                if (!(_url.startsWith('http://') || _url.startsWith('https://'))) _url = 'https://' + _url;
            }
            event.target.value = _url;
            SETTINGS[dat.key] = event.target.value;
            SETTINGS.save();

        })
        _elem_item_left.appendChild(_elem_item_left_input);
        _elem.appendChild(_elem_item_left);

        const _elem_item_right = document.createElement('div');
        _elem_item_right.classList.add('ave-item-right');
        _elem_item_right.innerHTML = `<label class="ave-settings-label-setting" data-ave-tooltip="${_labelDescription}">${_labelName}</label>`

        _elem.appendChild(_elem_item_right);

    } else if (dat.type == 'number') {

        const _elem_item_left = document.createElement('div');
        _elem_item_left.classList.add('ave-item-left');
        const _elem_item_left_input = document.createElement('input');
        _elem_item_left_input.type = 'number';
        _elem_item_left_input.className = 'ave-input-number';
        _elem_item_left_input.setAttribute('ave-data-key', dat.key);
        _elem_item_left_input.setAttribute('value', SETTINGS[dat.key]);
        if (!isNaN(dat.min)) _elem_item_left_input.setAttribute('min', dat.min);
        if (!isNaN(dat.max)) _elem_item_left_input.setAttribute('max', dat.max);
        _elem_item_left_input.addEventListener('change', (event) => {
            const _value = event.target.value;
            const _min = parseFloat(event.target.min);
            const _max = parseFloat(event.target.max);

            if(_value <= _max && _value >= _min){
                SETTINGS[dat.key] = parseInt(event.target.value);
                SETTINGS.save();
            }else{
                console.log("Eingabe Fehlerhaft");
            }

        })
        _elem_item_left_input.addEventListener('input', (event) => {
            const _value = event.target.value;
            const _min = parseFloat(event.target.min);
            const _max = parseFloat(event.target.max);

            if(_value <= _max && _value >= _min){
                event.target.style.borderColor = 'inherit';
                event.target.style.color = 'inherit';
            }else{
                event.target.style.borderColor = 'red';
                event.target.style.color = 'red';
            }
        })
        _elem_item_left.appendChild(_elem_item_left_input);
        _elem.appendChild(_elem_item_left);

        const _elem_item_right = document.createElement('div');
        _elem_item_right.classList.add('ave-item-right');
        _elem_item_right.innerHTML = `<label class="ave-settings-label-setting" data-ave-tooltip="${_labelDescription}">${_labelName}</label>`

        _elem.appendChild(_elem_item_right);

    } else if (dat.type == 'button') { 

        const _elem_item_left = document.createElement('div');
        _elem_item_left.classList.add('ave-item-left');

        const _elem_item_left_input_label  = document.createElement('label');
        _elem_item_left_input_label.setAttribute('data-ave-tooltip', _labelDescription);
        _elem_item_left_input_label.setAttribute('class', 'a-button');
        _elem_item_left_input_label.style.width = "250px";
        if (dat.bgColor) _elem_item_left_input_label.style.backgroundColor = dat.bgColor;
        const _elem_item_left_input = document.createElement('button');
        _elem_item_left_input.type = 'button';
        _elem_item_left_input.className = 'ave-input-button';

        _elem_item_left_input.innerText = _labelName;
        _elem_item_left_input.addEventListener('click', (event) => {console.log('This is a button Input', event); if(dat.btnClick) dat.btnClick();})

        _elem_item_left_input_label.appendChild(_elem_item_left_input);
        _elem_item_left.appendChild(_elem_item_left_input_label);
        _elem.appendChild(_elem_item_left);

    } else if (dat.type == 'color') {

        const _elem_item_left = document.createElement('div');
        _elem_item_left.classList.add('ave-item-left');
        const _elem_item_left_input = document.createElement('input');
        _elem_item_left_input.type = 'color';
        _elem_item_left_input.className = 'ave-input-color';
        _elem_item_left_input.setAttribute('ave-data-key', dat.key);
        _elem_item_left_input.setAttribute('value', colorToHex(SETTINGS[dat.key]));
        _elem_item_left_input.addEventListener('change', (event) => {console.log('This is a Color Value Input', event); SETTINGS[dat.key] = event.target.value; SETTINGS.save();})
        _elem_item_left.appendChild(_elem_item_left_input);
        _elem.appendChild(_elem_item_left);

        const _elem_item_right = document.createElement('div');
        _elem_item_right.classList.add('ave-item-right');
        _elem_item_right.innerHTML = `<label class="ave-settings-label-setting" data-ave-tooltip="${(dat.description && dat.description != '') ? dat.description : dat.name}">${dat.name}</label>`

        _elem.appendChild(_elem_item_right);

    } else if (dat.type == 'select') {
        const _elem_item_left = document.createElement('div');
        _elem_item_left.classList.add('ave-item-left');
        const _elem_item_left_input = document.createElement('select');
        _elem_item_left_input.className = 'ave-input-number';
        _elem_item_left_input.style.width = '300px';
        _elem_item_left_input.style.height = '21px';
        _elem_item_left_input.setAttribute('ave-data-key', dat.key);

        if (dat.options && Array.isArray(dat.options)) {
            dat.options.forEach((opt) => {
                const _option = document.createElement('option');
                _option.value = opt;
                _option.textContent = opt;
                _option.selected = opt === SETTINGS[dat.key];
                _elem_item_left_input.appendChild(_option);
            });
        }

        _elem_item_left_input.addEventListener('change', (event) => {
            console.log('This is a Select Input', event);
            SETTINGS[dat.key] = event.target.value;
            SETTINGS.save();
            if (dat.key === 'UI_LANGUAGE') {
                localStorage.setItem('AVE_OPEN_SETTINGS_TAB', '1');
                window.location.reload();
            }
        })
        _elem_item_left.appendChild(_elem_item_left_input);
        _elem.appendChild(_elem_item_left);

        const _elem_item_right = document.createElement('div');
        _elem_item_right.classList.add('ave-item-right');
        const _labelName = dat.key === 'UI_LANGUAGE'
            ? translate('settings', 'languageLabel', 'Sprache')
            : dat.name;
        const _labelDescription = (dat.description && dat.description != '') ? dat.description : _labelName;
        _elem_item_right.innerHTML = `<label class="ave-settings-label-setting" data-ave-tooltip="${_labelDescription}">${_labelName}</label>`;

        _elem.appendChild(_elem_item_right);

    } else if (dat.type == 'title'){
        const _elem_spacer_horizontal = document.createElement('hr');
        _elem_spacer_horizontal.style.width = '100%';

        const _elem_spacer_title = document.createElement('h4');
        _elem_spacer_title.textContent = _labelName;

        _elem.style.height = 'fit-content';
        _elem.style.display = 'flex';
        _elem.style.flexWrap = 'wrap';
        _elem.appendChild(_elem_spacer_horizontal);
        _elem.appendChild(_elem_spacer_title);
    } else if (dat.type == 'keywords') {
        if (SETTINGS[dat.key].length > 0) {
            SETTINGS[dat.key].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        }

        _elem.classList.remove('ave-settings-item');
        _elem.classList.add('ave-keyword-wrapper');
        _elem.innerHTML = `<h4>${_labelName}</h4>`;
        const _elem_keyword_input = document.createElement('div');
        _elem_keyword_input.innerHTML = '<span></span>';
        _elem_keyword_input.classList.add('ave-keyword-input');

        const _elem_keyword_input_label = document.createElement('label');
        _elem_keyword_input_label.setAttribute('data-ave-tooltip', _labelDescription);

        const _elem_keyword_input_input = document.createElement('textarea');
        _elem_keyword_input_input.setAttribute('cols', 70);
        _elem_keyword_input_input.setAttribute('rows', 1);
        _elem_keyword_input_input.setAttribute('placeholder', _inputPlaceholder || dat.inputPlaceholder);
        _elem_keyword_input_input.addEventListener('change', (elm, ev) => {
            if (SETTINGS.DebugLevel > 1) console.log('EVENTHANDLER CHANGE:', elm, 'event:', ev);
            const _value = elm.target.value.trim();
            if (_value && _value.length > 0) {
                for (let _key of _value.split('\n')) {
                    _key = _key.trim();
                    if (_key.length === 0) {
                        continue;
                    }
                    if (!SETTINGS[dat.key].includes(_key)) {
                        SETTINGS[dat.key].push(_key);
                    }
                }
            }
            SETTINGS.save();
            elm.target.value = '';
            const _table = document.getElementById(dat.key);
            _table.innerHTML = '';
            for (let i = 0; i < SETTINGS[dat.key].length; i++) {
                _table.appendChild(createSettingsKeywordsTableElement(dat, i, SETTINGS[dat.key][i]));
            }
        })
        _elem_keyword_input_label.appendChild(_elem_keyword_input_input);
        _elem_keyword_input.appendChild(_elem_keyword_input_label);
        _elem.appendChild(_elem_keyword_input);

        const _elem_keyword_list = document.createElement('div');
        _elem_keyword_list.classList.add('ave-keyword-list-wrapper');
        const _elem_keyword_list_table = document.createElement('table');
        const _elem_keyword_list_table_tbody = document.createElement('tbody');
        _elem_keyword_list_table_tbody.setAttribute('id', dat.key);
        for (let i = 0; i < SETTINGS[dat.key].length; i++){
            _elem_keyword_list_table_tbody.appendChild(createSettingsKeywordsTableElement(dat, i, SETTINGS[dat.key][i]));
        }
        _elem_keyword_list_table.appendChild(_elem_keyword_list_table_tbody);
        _elem_keyword_list.appendChild(_elem_keyword_list_table);
        _elem.appendChild(_elem_keyword_list);
    }

    return _elem;
}

function createSettingsKeywordsTableElement(dat, index, entry){
    const _tableRow = document.createElement('tr');
    _tableRow.setAttribute('index', index);
    const _tableRow_td1 = document.createElement('td');
    const _tableRow_td1_button = document.createElement('button');
    _tableRow_td1_button.innerHTML = `<i class="a-icon a-icon-close"></i>`;
    _tableRow_td1_button.setAttribute('ave-data-keyword', entry);
        _tableRow_td1_button.addEventListener('click', (elm, ev) =>{
        SETTINGS[dat.key].splice(index, 1);
        SETTINGS.save();
        const _table = document.getElementById(dat.key);
        _table.innerHTML = '';
        for (let i = 0; i < SETTINGS[dat.key].length; i++){
            _table.appendChild(createSettingsKeywordsTableElement(dat, i, SETTINGS[dat.key][i]));
        }
    });
    _tableRow_td1.appendChild(_tableRow_td1_button);
    _tableRow.appendChild(_tableRow_td1);
    const _tableRow_td2 = document.createElement('td');
    _tableRow_td2.innerText = entry;
    _tableRow.appendChild(_tableRow_td2);
    return _tableRow;
}

function componentToHex(c) {
    const _c = Math.min(c, 255)
    const _hex = _c.toString(16);
    return _hex.length == 1 ? "0" + _hex : _hex;
}

function rgbToHex(r, g, b){
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function rgbaToHex(r, g, b, a){
    return "#" + componentToHex(a) + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function colorToHex(color) {
    const _color = color.replace(/\s/g,''); 
    let _cache;

    if (_color == 'white'){
        return '#ffffff';
    } else if (_color == 'black'){
        return '#000000';
    } else if ((_cache = /rgb\(([\d]+),([\d]+),([\d]+)\)/.exec(_color))){ 
        return rgbToHex(_cache[1], _cache[2], _cache[3]);
    } else if ((_cache = /rgba\(([\d]+),([\d]+),([\d]+),([\d]+|[\d]*.[\d]+)\)/.exec(_color))){ 
        return rgbaToHex(_cache[1], _cache[2], _cache[3], _cache[4]);
    } else if (/#[0-9a-fA-F]{6}|[0-9a-fA-F]{8}$/.exec(_color)){ 
        return _color;
    }

}

unsafeWindow.ave.colorToHex = colorToHex;

function addDBCleaningSymbol(){
    const _cleaningDiv = document.createElement('div');
    _cleaningDiv.style.width = "25px";
    _cleaningDiv.style.height = "25px";
    _cleaningDiv.style.position = 'fixed';
    _cleaningDiv.style.zIndex = '9999';
    _cleaningDiv.style.left = '10px';
    _cleaningDiv.style.bottom = '35px';

    _cleaningDiv.innerHTML = `
    <style>
    .ave-cleaning {
      transform: translate(35%, -140%) scale(0.7);
    }
    .ave-cleaning svg {
      animation: rotate 2s linear infinite;
    }
    @keyframes rotate {
      0% {
        transform: translateX(-100%);
      }
      50% {
        transform: translateX(0);
      }
      100% {
        transform: translateX(-100%);
      }
    }
    </style>
    <div id="dbVector" class="ave-db"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M20 18C20 20.2091 16.4183 22 12 22C7.58172 22 4 20.2091 4 18V13.974C4.50221 14.5906 5.21495 15.1029 6.00774 15.4992C7.58004 16.2854 9.69967 16.75 12 16.75C14.3003 16.75 16.42 16.2854 17.9923 15.4992C18.7851 15.1029 19.4978 14.5906 20 13.974V18Z" fill="#1C274C"></path> <path d="M12 10.75C14.3003 10.75 16.42 10.2854 17.9923 9.49925C18.7851 9.10285 19.4978 8.59059 20 7.97397V12C20 12.5 18.2143 13.5911 17.3214 14.1576C15.9983 14.8192 14.118 15.25 12 15.25C9.88205 15.25 8.00168 14.8192 6.67856 14.1576C5.5 13.5683 4 12.5 4 12V7.97397C4.50221 8.59059 5.21495 9.10285 6.00774 9.49925C7.58004 10.2854 9.69967 10.75 12 10.75Z" fill="#1C274C"></path> <path d="M17.3214 8.15761C15.9983 8.81917 14.118 9.25 12 9.25C9.88205 9.25 8.00168 8.81917 6.67856 8.15761C6.16384 7.95596 5.00637 7.31492 4.2015 6.27935C4.06454 6.10313 4.00576 5.87853 4.03988 5.65798C4.06283 5.50969 4.0948 5.35695 4.13578 5.26226C4.82815 3.40554 8.0858 2 12 2C15.9142 2 19.1718 3.40554 19.8642 5.26226C19.9052 5.35695 19.9372 5.50969 19.9601 5.65798C19.9942 5.87853 19.9355 6.10313 19.7985 6.27935C18.9936 7.31492 17.8362 7.95596 17.3214 8.15761Z" fill="#1C274C"></path> </g></svg></div>
    <div id="loadingVector" class="ave-loading"><svg viewBox="-0.8 -0.8 17.60 17.60" xmlns="http://www.w3.org/2000/svg" fill="none" class="hds-flight-icon--animation-loading" stroke="#000000" stroke-width="0.8"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g fill="#000000" fill-rule="evenodd" clip-rule="evenodd"> <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8z" opacity=".2"></path> <path d="M7.25.75A.75.75 0 018 0a8 8 0 018 8 .75.75 0 01-1.5 0A6.5 6.5 0 008 1.5a.75.75 0 01-.75-.75z"></path> </g> </g></svg></div>
    `;
    document.body.appendChild(_loadingDiv);
    return _loadingDiv;
}

function getPageinationData(localDocument = document) {
    if (SETTINGS.DebugLevel > 10) console.log('Called getPageinationData()');
    const _ret = new Object();
    const _paginationContainer = localDocument.querySelector('.a-pagination');
    if (!_paginationContainer) return;
    if (!_paginationContainer.lastChild) return;

    let _currChild = _paginationContainer.lastChild;

    while ((!_ret.href || !_ret.maxPage) && _currChild) {
        const _curr = _currChild.firstChild;

        if (_curr && typeof _curr.hasAttribute === "function") {
            if (_curr.hasAttribute('href')) _ret.href = _curr.getAttribute('href').replace(/=[0-9]+/, '=');
            if (parseInt(_curr.text)) _ret.maxPage = parseInt(_curr.text);
        }
        _currChild = _currChild.previousSibling
    }
    return _ret;
}

// CleanUp and Fix Database Entrys
async function cleanUpDatabase(cb = () => {}) {
    if (SETTINGS.DebugLevel > 10) console.log('Called cleanUpDatabase()');
    const _dbCleanIcon = addDBCleaningSymbol();

    database.getAll().then((prodArr) => {

        const _prodArrLength = prodArr.length;
        const _workersProms = [];
        if (SETTINGS.DebugLevel > 10) console.log(`cleanUpDatabase() - Checking ${_prodArrLength} Entrys`);

        let _updated = 0;
        let _deleted = 0;
        let _vendorCleanupDate = toUnixTimestamp(localStorage.getItem('AVE_CLEANUP_LAST_TIME') || 0);
        let _normalCleanupDate = _vendorCleanupDate;
        if (_vendorCleanupDate < unixTimeStamp() - SECONDS_PER_DAY) {
            _vendorCleanupDate = unixTimeStamp() - SECONDS_PER_DAY;
        }
        if (_normalCleanupDate < unixTimeStamp() - SECONDS_PER_WEEK) {
            _normalCleanupDate = unixTimeStamp() - SECONDS_PER_WEEK;
        }

        let secondsBeforeCleanup = SETTINGS.HoursBeforeCleanup * 3600;
        let currentTimeStamp = unixTimeStamp();

        for (const _currEntry of prodArr) {
            _workersProms.push(new Promise((resolve, reject) => {
                let _needUpdate = false;

                if (!_currEntry.ts_firstSeen){
                    _currEntry.ts_firstSeen = (unixTimeStamp() - Math.round(Math.random() * (SECONDS_PER_WEEK / 2)));
                    _needUpdate = true;
                }

                if (!_currEntry.ts_lastSeen) {
                    _currEntry.ts_lastSeen = (_currEntry.ts_firstSeen + SECONDS_PER_DAY);
                    _needUpdate = true;
                }

                let _notSeenCounter = _currEntry.notSeenCounter;
                if (_currEntry.data_recommendation_type == 'VENDOR_TARGETED' &&  _currEntry.ts_lastSeen < _vendorCleanupDate) { 
                    _notSeenCounter++;
                } else if (_currEntry.ts_lastSeen < _normalCleanupDate) { 
                    _notSeenCounter++;
                }

                if (_currEntry.notSeenCounter != _notSeenCounter) {
                    _currEntry.notSeenCounter = _notSeenCounter;
                    _needUpdate = true;
                }

                if ((_currEntry.notSeenCounter > 0 && currentTimeStamp - _currEntry.ts_lastSeen >= secondsBeforeCleanup || _currEntry.forceRemove) && (!_currEntry.isFav || SETTINGS.EnableCleanupFavorites)) {
                    database.removeID(_currEntry.id).then((ret) => {
                        _deleted++;
                        resolve()
                    });
                } else if (!_needUpdate){
                    resolve()
                } else {
                    database.update(_currEntry).then((ret) => {_updated++; resolve();});
                }
            }))
        }

        Promise.allSettled(_workersProms).then(() => {
            if (SETTINGS.DebugLevel > 0) console.log(`Databasecleanup Finished: Entrys:${_prodArrLength} Updated:${_updated} Deleted:${_deleted}`);
            _dbCleanIcon.remove();
            localStorage.setItem('AVE_CLEANUP_LAST_TIME', Date.now());
            cb(true);
        })

    });
}

unsafeWindow.ave.dbCleanup = cleanUpDatabase;

function exportDatabase() {
    console.log('Create Database Dump...');

    database.getAll().then((db) => {
        try{
            const dbBlob = new Blob([JSON.stringify(db, null, 4)], {type: "application/json;charset=utf-8"});
            saveAs(dbBlob, "AmazonVineExplorerDatabase.json");

        } catch (error) {
            console.log("Oops, there was an error exporting AVE user database");
            console.log(error);
        }
    });
}


/**
 * Opens a file selector dialog and imports a database from a JSON file.
 * @async
 * @returns {Promise<void>}
 */
async function importDatabase() {
    return new Promise((resolve, reject) => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';

        fileInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];

            if (file) {
                try {
                    const jsonData = await readFile(file);
                    database.import(jsonData)
                    .then(() => {
                        console.log('Data imported successfully.');
                        alert('Data imported successfully');
                        resolve();
                    })
                    .catch((error) => {
                        console.error('Error importing data:', error);
                        alert(`Error importing data: ${error}`);
                        reject(error);
                    });
                } catch (error) {
                    console.error('Error importing data:', error);
                    alert(`Error importing data: ${error}`);
                    reject(error);
                }
            }
        });

        fileInput.click();
    });
}

unsafeWindow.ave.importDB = importDatabase;

/**
 * Reads the content of a file as text.
 * @param {File} file - The file to read.
 * @returns {Promise<string>} - A Promise that resolves to the file content as a string.
 */
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                resolve(JSON.parse(event.target.result));
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = (error) => {
            reject(error);
        };

        reader.readAsText(file);
    });
}

function startAutoScan() {
    if (SETTINGS.DebugLevel > 10) console.log('Called startAutoScan()');
    showAutoScanScreen('Init Autoscan, please wait...');
    markAllCurrentDatabaseProductsAsSeen(() => {
        if (SETTINGS.DebugLevel > 10) console.log('startAutoScan() - Got Callback from markAllCurrentDatabaseProductsAsSeen()');
        const _pageiDat = getPageinationData();
        localStorage.setItem('AVE_INIT_AUTO_SCAN', false);
        localStorage.setItem('AVE_AUTO_SCAN_IS_RUNNING', true);
        localStorage.setItem('AVE_AUTO_SCAN_PAGE_MAX',_pageiDat.maxPage);
        localStorage.setItem('AVE_AUTO_SCAN_PAGE_CURRENT', 1);
        setTimeout(() => {
            const _url = `${_pageiDat.href}1`;
            if (SETTINGS.DebugLevel > 10) console.log(`Loding new Page ${_url}`)
            window.location.href = _url;
        }, 5000);
    })
}

function handleAutoScan() {
    const _delay = Math.max(SETTINGS.PageLoadMinDelay - (Date.now() - PAGE_LOAD_TIMESTAMP), 0) + 500;
    if (SETTINGS.DebugLevel > 10) console.log(`handleAutoScan() - _delay: ${_delay}`);
    if (AUTO_SCAN_PAGE_CURRENT < AUTO_SCAN_PAGE_MAX) {
        const _nextPage = AUTO_SCAN_PAGE_CURRENT + 1;
        localStorage.setItem('AVE_AUTO_SCAN_PAGE_CURRENT', _nextPage);
        setTimeout(() => {
            window.location.href = window.location.href.replace(/=[0-9]+/, `=${_nextPage}`);
        }, _delay);
    } else { // We are done ;)
        updateAutoScanScreenText('Success, cleaning up Database...');
        cleanUpDatabase(()=> {
            localStorage.setItem('AVE_AUTO_SCAN_IS_RUNNING', false);
            localStorage.setItem('AVE_AUTO_SCAN_PAGE_MAX', -1);
            localStorage.setItem('AVE_AUTO_SCAN_PAGE_CURRENT', -1);
            setTimeout(() => {
                updateAutoScanScreenText('Finished Database\nupdate and cleanup\n\nPage reloading incoming... please wait');
                setTimeout(()=> {
                    window.location.href = window.location.href.replace(/=[0-9]+/, '=1');
                }, 10000);
            }, _delay + 2000);
        });
    }
}

function stickElementToTopScrollEVhandler(elemID, dist) {
    const _elem = document.getElementById(elemID);
    if (_elem) {
        const maxScrollHeight = Math.max(
            document.body.scrollHeight - window.innerHeight,
            document.documentElement.scrollHeight - window.innerHeight
        );

        requestAnimationFrame(() => {
            const _elemRect = _elem.getBoundingClientRect();

            const _elemInitialTop = parseInt(_elem.getAttribute('ave-data-default-top'));
            if (!_elemInitialTop) {_elem.setAttribute('ave-data-default-top', (window.scrollY + _elemRect.top));}
            if (!_elem || !_elemRect) return;

            if (window.scrollY >= (_elemInitialTop - parseInt(dist))) {
                _elem.style.position = "fixed";
                _elem.style.top = dist;
            } else {
                _elem.style.position = "static";
            }
        })
    }
}

let lastDesktopNotifikationTimestamp = 0;

/**
 * Update the favorites badge count in the navigation bar.
 */
function updateFavoritesBtn(){
    database.getFavEntries().then((favArr) => {
        const _btnFavBadge = document.getElementById('ave-fav-items-btn-badge');
        if (favArr.length > 0) {
            _btnFavBadge.style.display = 'inline-block';
            _btnFavBadge.innerText = favArr.length;
        } else {
            _btnFavBadge.style.display = 'none';
            _btnFavBadge.innerText = '';
        }
    });
}

/**
 * Update the "new entries" badge and trigger threshold notifications.
 */
function updateNewProductsBtn() {
    if (AUTO_SCAN_IS_RUNNING) return;
    if (SETTINGS.DebugLevel > 1) console.log('Called updateNewProductsBtn()');
    database.getNewEntries().then((prodArr) => {
        const _btnBadge = document.getElementById('ave-new-items-btn-badge');
        const _pageTitle = document.title.replace(/^[^|]*\|/, '').trim();
        const _prodArrLength = prodArr.length;
        if (SETTINGS.DebugLevel > 1) console.log(`updateNewProductsBtn(): Got Database Response: ${_prodArrLength} New Items`);

        if (_prodArrLength > 0) {
            const _badgeCount = parseInt((_btnBadge && _btnBadge.innerText) ? _btnBadge.innerText : '0', 10) || 0;
            if (SETTINGS.UnseenItemsNotificationThreshold > 0 &&
                _prodArrLength >= SETTINGS.UnseenItemsNotificationThreshold &&
                _badgeCount < SETTINGS.UnseenItemsNotificationThreshold) {

                let _shouldNotify = true;

                if (SETTINGS.UnseenItemsNotificationRepitionMinutes > 0) {
                    let _lastUnseenMS = Date.now() - (localStorage.getItem('AVE_LAST_UNSEEN_NOTIFICATION') || 0);
                    let _lastUnseenMinutes = _lastUnseenMS / 1000 / 60;

                    if (_lastUnseenMinutes < SETTINGS.UnseenItemsNotificationRepitionMinutes) {
                        _shouldNotify = false;
                    }
                }

                if (_shouldNotify) {
                    localStorage.setItem('AVE_LAST_UNSEEN_NOTIFICATION', Date.now());

                    if (SETTINGS.GotifyUrl) {
                        gotifyNotification(translate('notifications', 'unseenItemsBody', `Es wurden ${_prodArrLength} neue Eintraege gefunden`, _prodArrLength));
                    }
                    if (SETTINGS.EnableDesktopNotifikation) {
                        desktopNotifikation(
                            translate('notifications', 'unseenItemsTitle', `Amazon Vine Explorer - ${AVE_VERSION}`, AVE_VERSION),
                            translate('notifications', 'unseenItemsBody', `Es wurden ${_prodArrLength} neue Eintraege gefunden`, _prodArrLength)
                        );
                    }
                }
            }

            _btnBadge.style.display = 'inline-block';
            _btnBadge.innerText = _prodArrLength;
            document.title = `${_prodArrLength} | ${_pageTitle}`;
        } else {
            _btnBadge.style.display = 'none';
            _btnBadge.innerText = '';
            document.title = `${_pageTitle}`;
        }

        let _notifyed = false;
        if ((SETTINGS.EnableDesktopNotifikation || SETTINGS.EnableAutoMarkFavorite || SETTINGS.GotifyUrl) && SETTINGS.DesktopNotifikationKeywords?.length > 0) {

            const _configKeyWords = SETTINGS.DesktopNotifikationKeywords;

            var stringToRegex = (s, m) => ((m = s.match(/^\/(.*?)\/([gimsuy]*)$/))) ? new RegExp(m[1], m[2].split('').filter((i, p, s) => s.indexOf(i) === p).join('')) : undefined;

            for (let i = 0; i < _prodArrLength; i++) {
                const _prod = prodArr[i];
                const _descFull = _prod.description_full.toLowerCase();

                if (_prod.isNotified){
                    continue;
                }

                const _configkeyWordsLength = _configKeyWords.length;

                for (let j = 0; j < _configkeyWordsLength; j++) {
                    const _currKey = _configKeyWords[j].toLowerCase();
                    let _keyFound = false;
                    const _regExp = stringToRegex(_currKey);
                    if (_regExp !== undefined) {
                       _keyFound = _regExp.test(_descFull);
                    }
                    else {
                        _keyFound = _descFull.includes(_currKey);
                    }
                    if (_keyFound) {
                        if (SETTINGS.EnableDesktopNotifikation) {
                            desktopNotifikation(`Amazon Vine Explorer - ${AVE_VERSION}`, `${_prod.description_full}\nkey: ${_currKey}`, fixProductImageUrl(_prod.data_img_url), true, function (event) {
                                event.preventDefault();
                                const newUrl = `${window.location.origin}/vine/vine-items?vine-data=${encodeURIComponent(JSON.stringify({
                                    asin: _prod.data_asin,
                                    isParentAsin: _prod.data_asin_is_parent,
                                    recommendationId: _prod.data_recommendation_id,
                                    tax: _prod.data_estimated_tax,
                                }))}`;
                                window.open(newUrl, '_blank');
                            });
                        }
                        if (SETTINGS.GotifyUrl) {
                            if (_prod.link) {
                                gotifyNotification(
                                    `[![](${fixProductImageUrl(_prod.data_img_url)})](${window.location.origin + _prod.link})  \n${_prod.description_full}  \nMatched key: ${_currKey}`,
                                    _prod);
                            } else {
                                gotifyNotification(
                                    `![](${fixProductImageUrl(_prod.data_img_url)})  \n${_prod.description_full}  \nMatched key: ${_currKey}`
                                );
                            }
                        }
                        _notifyed = true;
                        _prod.isNotified = true;
                        if (SETTINGS.EnableAutoMarkFavorite) {
                            _prod.isFav = 1;
                        }
                        database.update(_prod);
                        break;
                    }
                }
            }
        }
        if (SETTINGS.EnableDesktopNotifikation && SETTINGS.DesktopNotifikationDelay > 0 && !_notifyed && _prodArrLength > oldCountOfNewItems){
            if (unixTimeStamp() - lastDesktopNotifikationTimestamp >= SETTINGS.DesktopNotifikationDelay) {
                oldCountOfNewItems = _prodArrLength;
                lastDesktopNotifikationTimestamp = unixTimeStamp();

                desktopNotifikation(`Amazon Vine Explorer - ${AVE_VERSION}` , `Es wurden ${_prodArrLength} neue Vine Produkte gefunden`);
            }
        }
    })
}

/**
 * Send a Desktop Notifikation
 * @param {string} title
 * @param {string} message
 * @param {string} icon
 *
 */
function desktopNotifikation(title, message, image = null, requireInteraction = null, onClick = () => {}) {
    const _vineLogo = 'https://raw.githubusercontent.com/danieldur/AmazonVineExplorerLite/main/vine_logo.png';
    const _vineLogoImp = 'https://raw.githubusercontent.com/danieldur/AmazonVineExplorerLite/main/vine_logo_important.png'
    const _defaultImage = 'https://raw.githubusercontent.com/danieldur/AmazonVineExplorerLite/main/vine_logo_notification_image.png'

    if (Notification.permission === 'granted') {
        const _notification = new Notification(title, {
            body: message,
            icon: (!requireInteraction) ? _vineLogo : _vineLogoImp,
            image: image || _defaultImage,
            tag: (requireInteraction) ? `ave-notify-${Math.round(Math.random()* 10000000)}`: 'ave-notify',
            requireInteraction: requireInteraction,
        });

        _notification.onclick = onClick;
    } else {
        Notification.requestPermission().then(function(permission) {
            if (permission === 'granted') {
                console.log('Berechtigung für Benachrichtigungen erhalten!');
                desktopNotifikation(title, message);
            }
        });
    }
}

function gotifyNotification(message, prod = null) {
    const url = SETTINGS.GotifyUrl + 'message?token=' + SETTINGS.GotifyToken;
    const bodyFormData = prod ? {
        title: `Amazon Vine Explorer - ${AVE_VERSION}`,
        message: message,
        priority: 5,
        extras: {
            'client::display': {
                "contentType": "text/markdown"
            },
            'client::notification': {
                click: { url: window.location.origin + prod.link },
                bigImageUrl: fixProductImageUrl(prod.data_img_url)
            }
        }
    } : {
        title: `Amazon Vine Explorer - ${AVE_VERSION}`,
        message: message,
        priority: 5,
        extras: {
            'client::display': {
                "contentType": "text/markdown"
            }
        }
    };
    GM.xmlHttpRequest({
        method: 'POST',
        url: url,
        data: JSON.stringify(bodyFormData),
        headers: {
            'Content-Type': 'application/json'
        },
        onload: function (response) {
            console.log('Response:', response.responseText);
        },
        onerror: function (err) {
            console.error('Error:', err);
        }
    });
}

function getContrastColor(hexColor) {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 125 ? 'black' : 'white';
}

function createNavButton(mainID, text, textID, color, onclick, badgeId, badgeValue, badgeColor) {
    const _btn = document.createElement('span');
    _btn.setAttribute('id', mainID);
    _btn.setAttribute('class', 'a-button a-button-normal a-button-toggle vvp-items-button');
    _btn.addEventListener('click', onclick);

    const _btnInner = document.createElement('span');
    _btnInner.classList.add('a-button-inner');
    _btnInner.style.backgroundColor = color;
    _btnInner.style.display = 'flex';
    _btn.append(_btnInner);

    const _btnInnerText = document.createElement('span');
    _btnInnerText.setAttribute('id', textID);
    _btnInnerText.classList.add('a-button-text');
    _btnInnerText.innerText = text;
    _btnInner.append(_btnInnerText);

    if (badgeId) {
        const _btnInnerBadge = document.createElement('span');
        _btnInnerBadge.setAttribute('id', badgeId)
        _btnInnerBadge.setAttribute('class', 'a-button-text')
        _btnInnerBadge.style.backgroundColor = badgeColor;
        _btnInnerBadge.style.color = getContrastColor(badgeColor);
        _btnInnerBadge.style.display = 'inline-block';
        _btnInnerBadge.style.textAlign = 'center';
        _btnInnerBadge.style.zIndex = '50';
        _btnInnerBadge.style.position = 'relativ';

        _btnInnerBadge.innerText = badgeValue;
        _btnInner.append(_btnInnerBadge);
    }

    return _btn;
}

function addStyleToTile(_currTile, _product) {
    if (!_product.gotFromDB) { // We have a new one ==> Save it to our Database ;)
        database.add(_product);
        _currTile.style.cssText = SETTINGS.CssProductSaved;
        _currTile.classList.add('ave-element-saved');
    } else {
        let _style = SETTINGS.CssProductDefault;
        if (_product.isNew) {
            _style = SETTINGS.CssProductNewTag;
            _currTile.classList.add('ave-element-new');
        }
        if (_product.isFav) {
            _style = SETTINGS.CssProductFavTag;
            _currTile.classList.add('ave-element-fav');
        }
        _currTile.style.cssText = _style;
    }
    _currTile.prepend(createFavStarElement(_product));
    _currTile.prepend(createFirstSeenElement(_product));
    _currTile.prepend(createShareElement(_product));
    waitForHtmlElement('.vvp-item-product-title-container', (_elem) => {
        if (!_elem) return;

        insertHtmlElementAfter(_elem, createTaxInfoElement(_product));
    }, _currTile);
    waitForHtmlElement('.vvp-item-badges', (_itemBadge) => {
        if (!_itemBadge) return;

        _itemBadge.style.marginTop = '20px';
    }, _currTile);
}

async function requestProductDetails(prod) {
    if (prod.data_asin_is_parent) {
        const res = await vineFetch(`${window.location.origin}/vine/api/recommendations/${prod.id}`.replace(/#/g, '#')).then(r => r.json());
        if (res.error) {
            if (res.error.exceptionType == 'ITEM_NOT_IN_ENROLLMENT') {
                prod.forceRemove = true;
            } else {
                console.error('requestProductDetails():ERROR:', res.error);
                throw res.error.exceptionType;
            }
        }
        const _data = res.result;
        if (SETTINGS.DebugLevel > 1) console.log('DATA:', _data);
        prod.data_childs = _data.variations || [];
        return prod;
    } else {
        const ret = await vineFetch(`${window.location.origin}/vine/api/recommendations/${prod.id}/item/${prod.data_asin}`.replace(/#/g, '%23')).then(r => r.json());
        if (SETTINGS.DebugLevel > 1) console.log('RETURN:', ret);
        if (ret.error) {
            throw ret.error.exceptionType;
        }
        const data = ret.result;
        prod.data_feature_bullets = data.featureBullets;
        prod.data_contributors = data.byLineContributors;
        prod.data_catalogSize = data.catalogSize;
        prod.data_tax_currency = data.taxCurrency;
        prod.data_estimated_tax_prize = data.taxValue;
        prod.data_limited_quantity = data.limitedQuantity;
        return prod;
    }
}

function init(hasTiles) {
    if (AUTO_SCAN_IS_RUNNING) showAutoScanScreen(`Autoscan is running...Page (${AUTO_SCAN_PAGE_CURRENT}/${AUTO_SCAN_PAGE_MAX})`);

    const _aveSubpageRequest = getUrlParameter('ave-subpage');
    if (SETTINGS.DebugLevel > 10) console.log(`Got Subpage Parameter`, _aveSubpageRequest)

    if (_aveSubpageRequest) createNewSite(parseInt(_aveSubpageRequest));

    if (hasTiles) {
        const _tiles = document.getElementsByClassName('vvp-item-tile');

        const _tilesLength = _tiles.length;
        const _tilePorms = [];
        for (let i = 0; i < _tilesLength; i++) {
            const _currTile = _tiles[i];
            _currTile.style.cssText = "background-color: yellow;";
            _tilePorms.push(parseTileData(_currTile).then((_product) => {
                addStyleToTile(_currTile, _product);
            }));
        }
        Promise.allSettled(_tilePorms).then(() => {
            if(INIT_AUTO_SCAN) {
                startAutoScan();
            } else if (AUTO_SCAN_IS_RUNNING) {
                handleAutoScan();
            }
        })
    } else {
        if (SETTINGS.DebugLevel > 10) console.log(`init(): NO TILES TO PARSE ON THIS SITE => SKIP`);
    }

    if (AUTO_SCAN_IS_RUNNING) return;

    const _searchbarContainer = document.getElementById('vvp-items-button-container');

    _searchbarContainer.appendChild(createNavButton('ave-btn-favorites', translate('buttons', 'favorites', 'Favoriten'), '', SETTINGS.BtnColorFavorites, () => {createNewSite(PAGETYPE.FAVORITES);}, 'ave-fav-items-btn-badge', '-', SETTINGS.BtnColorFavoritesBadge));
    _searchbarContainer.appendChild(createNavButton('ave-btn-list-new', translate('buttons', 'newEntries', 'Neue Einträge'), 'ave-new-items-btn', SETTINGS.BtnColorNewProducts, () => {createNewSite(PAGETYPE.NEW_ITEMS);}, 'ave-new-items-btn-badge', '-', SETTINGS.BtnColorNewProductsBadge));

    updateNewProductsBtn();
    updateFavoritesBtn();

    // Searchbar
    const _searchBarSpan = document.createElement('span');
    _searchBarSpan.setAttribute('class', 'ave-search-container');
    _searchBarSpan.style.cssText = `margin-left: 0.5em;`;

    const _searchBarInput = document.createElement('input');
    _searchBarInput.setAttribute('type', 'search');
    _searchBarInput.setAttribute('placeholder', 'Suche Vine Produkte');
    _searchBarInput.setAttribute('name', 'ave-search');
    _searchBarInput.style.cssText = `width: 15em;`;
    _searchBarInput.addEventListener('keyup', (ev) => {
        const _input = _searchBarInput.value.toLowerCase();
        if (SETTINGS.DebugLevel > 10) console.log(`Updated Input: ${_input}`);
        if (_input.length >= 2) {
            if (searchInputTimeout) clearTimeout(searchInputTimeout);
            searchInputTimeout = setTimeout(() => {
                database.query(_input.split(' ')).then((_objArr) => {
                    createNewSite(PAGETYPE.SEARCH_RESULT, _objArr);
                    searchInputTimeout = null;
                })
            }, ev.key === 'Enter' ? 1 : SETTINGS.SearchBarInputDelay);
        }
    });

    _searchBarSpan.appendChild(_searchBarInput);
    _searchbarContainer.appendChild(_searchBarSpan);

    initGlobalEventDelegation();

    if (hasTiles) addLeftSideButtons();

    // Modify Pageination if exists
    const _paginationContainers = document.querySelectorAll('.a-pagination');
    _paginationContainers.forEach(_paginationContainer => {
        if (SETTINGS.DebugLevel > 10) console.log('Manipulating Pagination');

        const _nextBtn = _paginationContainer.lastChild;
        const _isNextBtnDisabled = _nextBtn.classList.contains('a-disabled');
        const _nextBtnLink = _nextBtn.lastChild.getAttribute('href');
        const _btn = _nextBtn.cloneNode(true);
        const anchorTag = _btn.querySelector('a');

        const _aveNextPageButtonText = 'Gelesen <span class="a-letter-space"></span><span class="a-letter-space"></span><span class="larr">→</span>';

        const _AveNextArrow = document.createElement('style');
        _AveNextArrow.type = 'text/css';
        _AveNextArrow.innerHTML = `.ave-arrow::after{border-style: solid; border-width: 2px 2px 0 0; content: ''; padding: 2.5px; visibility: visible; display: inline-block; position: relative; left: -9px; top: -1px; transform: rotate(45deg);}`;

        if (!_isNextBtnDisabled) {
            _nextBtn.setAttribute('class', 'a-normal');
            _nextBtn.querySelector('span.larr').style.visibility = 'hidden';
            _nextBtn.querySelector('span.larr').classList.add('ave-arrow');
        }

        if (anchorTag) {
            anchorTag.innerHTML = _aveNextPageButtonText;
        }
        else {
            _btn.innerHTML = 'Gelesen'
        }

        _btn.style.color = 'unset';
        _btn.style.backgroundColor = 'lime';
        _btn.style.borderRadius = '8px';
        _btn.style.cursor = 'pointer';

        _btn.addEventListener('click', () => {
            markAllCurrentSiteProductsAsSeen(() => {
                if(!_nextBtn.classList.contains('a-disabled')){
                    window.location.href = (_nextBtnLink);
                }
            });
        })

        _paginationContainer.appendChild(_btn);
        _paginationContainer.appendChild(_AveNextArrow);
    });
}

//Sort Items by key
function sort_by_key(array, key, order)
{
    return array.sort(function(a, b) {
        var x = a[key]; var y = b[key];
        const multiplier = order === "asc" ? 1 : -1;
        return ((x < y) ? -1 : ((x > y) ? 1 : 0))*multiplier;
    });
}

function fixProductImageUrl(url) {
    return (url.replace(/\/images\/.*\/images\//, '/images/'));
}
