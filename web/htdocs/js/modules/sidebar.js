// Copyright (C) 2019 tribe29 GmbH - License: GNU General Public License v2
// This file is part of Checkmk (https://checkmk.com). It is subject to the terms and
// conditions defined in the file COPYING, which is part of this source code package.

import * as utils from "utils";
import * as ajax from "ajax";
import * as quicksearch from "quicksearch";

var g_content_loc   = null;
var g_sidebar_folded = false;


export function initialize_sidebar(update_interval, refresh, restart) {
    if (restart) {
        sidebar_restart_time = Math.floor(Date.parse(new Date()) / 1000);
    }

    sidebar_update_interval = update_interval;

    register_edge_listeners();
    set_sidebar_size();

    refresh_snapins = refresh;
    restart_snapins = restart;

    execute_sidebar_scheduler();
    register_event_handlers();
    if (is_content_frame_accessible()) {
        update_content_location();
    }
}


export function register_event_handlers() {
    window.addEventListener("mousemove", function(e) {
        snapinDrag(e);
        dragScroll(e);
        return false;
    }, false);
    window.addEventListener("mousedown", startDragScroll, false);
    window.addEventListener("mouseup", stopDragScroll,  false);
    window.addEventListener("wheel", scrollWheel, false);
    window.onresize = function() {
        set_sidebar_size();
    };
}

// This ends drag scrolling when moving the mouse out of the sidebar
// frame while performing a drag scroll.
// This is no 100% solution. When moving the mouse out of browser window
// without moving the mouse over the edge elements the dragging is not ended.
export function register_edge_listeners(obj) {
    let edges;
    if (!obj)
        edges = [ parent.frames[0], document.getElementById("side_header"), document.getElementById("side_footer") ];
    else
        edges = [ obj ];

    for(let i = 0; i < edges.length; i++) {
        // It is possible to open other domains in the content frame - don't register
        // the event in that case. It is not permitted by most browsers!
        if(!is_content_frame_accessible())
            continue;

        if (window.addEventListener)
            edges[i].addEventListener("mousemove", on_mouse_leave, false);
        else
            edges[i].onmousemove = on_mouse_leave;
    }
}

function on_mouse_leave(e) {
    if (typeof(quicksearch.close_popup) != "undefined")
        quicksearch.close_popup();
    return stop_snapin_dragging(e);
}

function stop_snapin_dragging(e) {
    stopDragScroll(e);
    snapinTerminateDrag(e);
    return false;
}

/************************************************
 * snapin drag/drop code
 *************************************************/

var snapinDragging = false;
var snapinOffset   = [ 0, 0 ];
var snapinStartPos = [ 0, 0 ];
var snapinScrollTop = 0;

export function snapin_start_drag(event) {
    if (!event)
        event = window.event;

    const target = utils.get_target(event);
    const button = utils.get_button(event);

    // Skip calls when already dragging or other button than left mouse
    if (snapinDragging !== false || button != "LEFT" || target.tagName != "DIV")
        return true;

    event.cancelBubble = true;

    snapinDragging = target.parentNode;

    // Save relative offset of the mouse to the snapin title to prevent flipping on drag start
    snapinOffset   = [ event.clientY - target.parentNode.offsetTop,
        event.clientX - target.parentNode.offsetLeft ];
    snapinStartPos = [ event.clientY, event.clientX ];
    snapinScrollTop = document.getElementById("side_content").scrollTop;

    // Disable the default events for all the different browsers
    return utils.prevent_default_events(event);
}

function snapinDrag(event) {
    if (!event)
        event = window.event;

    if (snapinDragging === false)
        return true;

    // Is the mouse placed of the title bar of the snapin?
    // It can move e.g. if the scroll wheel is wheeled during dragging...

    // Drag the snapin
    snapinDragging.style.position = "absolute";
    let newTop = event.clientY  - snapinOffset[0] - snapinScrollTop;
    newTop += document.getElementById("side_content").scrollTop;
    snapinDragging.style.top      = newTop + "px";
    snapinDragging.style.left     = (event.clientX - snapinOffset[1]) + "px";
    snapinDragging.style.zIndex   = 200;

    // Refresh the drop marker
    removeSnapinDragIndicator();

    const line = document.createElement("div");
    line.setAttribute("id", "snapinDragIndicator");
    const o = getSnapinTargetPos();
    if (o != null) {
        snapinAddBefore(o.parentNode, o, line);
    } else {
        snapinAddBefore(snapinDragging.parentNode, null, line);
    }
    return true;
}

function snapinAddBefore(par, o, add) {
    if (o != null) {
        par.insertBefore(add, o);
    } else {
        par.appendChild(add);
    }
}

function removeSnapinDragIndicator() {
    const o = document.getElementById("snapinDragIndicator");
    if (o) {
        o.parentNode.removeChild(o);
    }
}

function snapinDrop(event, targetpos) {
    if (snapinDragging == false)
        return true;

    // Reset properties
    snapinDragging.style.top      = "";
    snapinDragging.style.left     = "";
    snapinDragging.style.position = "";

    // Catch quick clicks without movement on the title bar
    // Don't reposition the object in this case.
    if (snapinStartPos[0] == event.clientY && snapinStartPos[1] == event.clientX) {
        return utils.prevent_default_events(event);
    }

    const par = snapinDragging.parentNode;
    par.removeChild(snapinDragging);
    snapinAddBefore(par, targetpos, snapinDragging);

    // Now send the new information to the backend
    const thisId = snapinDragging.id.replace("snapin_container_", "");

    let before = "";
    if (targetpos != null)
        before = "&before=" + targetpos.id.replace("snapin_container_", "");
    ajax.get_url("sidebar_move_snapin.py?name=" + thisId + before);
}

function snapinTerminateDrag() {
    if (snapinDragging == false)
        return true;
    removeSnapinDragIndicator();
    // Reset properties
    snapinDragging.style.top      = "";
    snapinDragging.style.left     = "";
    snapinDragging.style.position = "";
    snapinDragging = false;
}

export function snapin_stop_drag(event) {
    if (!event)
        event = window.event;

    removeSnapinDragIndicator();
    snapinDrop(event, getSnapinTargetPos());
    snapinDragging = false;
}

function getDivChildNodes(node) {
    const children = [];
    const childNodes = node.childNodes;
    for (let i = 0; i < childNodes.length; i++)
        if(childNodes[i].tagName === "DIV")
            children.push(childNodes[i]);
    return children;
}

function getSnapinList() {
    if (snapinDragging === false)
        return true;

    const l = [];
    const childs = getDivChildNodes(snapinDragging.parentNode);
    for(let i = 0; i < childs.length; i++) {
        const child = childs[i];
        // Skip
        // - non snapin objects
        // - currently dragged object
        if (child.id && child.id.substr(0, 7) == "snapin_" && child.id != snapinDragging.id)
            l.push(child);
    }

    return l;
}

function getSnapinCoords(obj) {
    const snapinTop = snapinDragging.offsetTop;
    // + document.getElementById("side_content").scrollTop;

    let bottomOffset = obj.offsetTop + obj.clientHeight - snapinTop;
    if (bottomOffset < 0)
        bottomOffset = -bottomOffset;

    let topOffset = obj.offsetTop - snapinTop;
    if (topOffset < 0)
        topOffset = -topOffset;

    let offset = topOffset;
    let corner = 0;
    if (bottomOffset < topOffset) {
        offset = bottomOffset;
        corner = 1;
    }

    return [ bottomOffset, topOffset, offset, corner ];
}

function getSnapinTargetPos() {
    const childs = getSnapinList();
    let objId = -1;
    let objCorner = -1;

    // Find the nearest snapin to current left/top corner of
    // the currently dragged snapin
    for(let i = 0; i < childs.length; i++) {
        const child = childs[i];

        if (!child.id || child.id.substr(0, 7) != "snapin_" || child.id == snapinDragging.id)
            continue;

        // Initialize with the first snapin in the list
        if (objId === -1) {
            objId = i;
            const coords = getSnapinCoords(child);
            objCorner = coords[3];
            continue;
        }

        // First check which corner is closer. Upper left or
        // the bottom left.
        const curCoords = getSnapinCoords(childs[objId]);
        const newCoords = getSnapinCoords(child);

        // Is the upper left corner closer?
        if (newCoords[2] < curCoords[2]) {
            objCorner = newCoords[3];
            objId = i;
        }
    }

    // Is the dragged snapin dragged above the first one?
    if (objId == 0 && objCorner == 0)
        return childs[0];
    else
        return childs[(parseInt(objId)+1)];
}

/************************************************
 * misc sidebar stuff
 *************************************************/

// Checks if the sidebar can access the content frame. It might be denied
// by the browser since it blocks cross domain access.
export function is_content_frame_accessible() {
    try {
        parent.frames[0].document;
        return true;
    } catch (e) {
        return false;
    }
}

export function update_content_location() {
    // initialize the original title
    if (typeof(window.parent.orig_title) == "undefined") {
        window.parent.orig_title = window.parent.document.title;
    }

    const content_frame = parent.frames[0];

    // Change the title to add the frame title to reflect the
    // title of the content URL title (window title or tab title)
    let page_title;
    if (content_frame.document.title != "") {
        page_title = window.parent.orig_title + " - " + content_frame.document.title;
    } else {
        page_title = window.parent.orig_title;
    }
    window.parent.document.title = page_title;

    // Construct the URL to be called on page reload
    const parts = window.parent.location.pathname.split("/");
    parts.pop();
    const cmk_path = parts.join("/");
    const rel_url = content_frame.location.pathname + content_frame.location.search + content_frame.location.hash;
    const index_url = cmk_path + "/index.py?start_url=" + encodeURIComponent(rel_url);

    if (window.parent.history.replaceState) {
        if (rel_url && rel_url != "blank") {
            // Update the URL to be called on reload, e.g. via F5, to switch to exactly this URL
            window.parent.history.replaceState({}, page_title, index_url);

            // only update the internal flag var if the url was not blank and has been updated
            //otherwise try again on next scheduler run
            g_content_loc = content_frame.document.location.href;
        }
    } else {
        // Only a browser without history.replaceState support reaches this. Sadly
        // we have no F5/reload fix for them...
        g_content_loc = content_frame.document.location.href;
    }
}

// Set the size of the sidebar_content div to fit the whole screen
// but without scrolling. The height of the header and footer divs need
// to be treated here.
export function set_sidebar_size() {
    const oHeader  = document.getElementById("side_header");
    const oContent = document.getElementById("side_content");
    const oFooter  = document.getElementById("side_footer");
    const height   = utils.page_height();

    // Don't handle zero heights
    if (height == 0)
        return;

    // -2 -> take outer border of oHeader and oFooter into account
    oContent.style.height = (height - oHeader.clientHeight - oFooter.clientHeight - 2) + "px";
}

var scrolling = true;

export function scroll_window(speed){
    const c = document.getElementById("side_content");

    if (scrolling) {
        c.scrollTop += speed;
        setTimeout("cmk.sidebar.scroll_window("+speed+")", 10);
    }
}

/************************************************
 * drag/drop scrollen
 *************************************************/

var dragging = false;
var startY = 0;

function startDragScroll(event) {
    if (!event)
        event = window.event;

    const target = utils.get_target(event);
    const button = utils.get_button(event);

    if (button != "LEFT")
        return true; // only care about left clicks!

    if (g_sidebar_folded) {
        unfold_sidebar();
        return utils.prevent_default_events(event);
    }
    else if (!g_sidebar_folded && event.clientX < 10 && target.tagName != "OPTION") {
        // When clicking on an <option> of the "core performance" snapins, an event
        // with event.clientX equal 0 is triggered, don"t know why. Filter out clicks
        // on OPTION tags.
        fold_sidebar();
        return utils.prevent_default_events(event);
    }

    if (dragging === false
        && target.tagName != "A"
        && target.tagName != "INPUT"
        && target.tagName != "SELECT"
        && target.tagName != "OPTION"
        && !(target.tagName == "DIV" && target.className == "heading")) {

        dragging = event;
        startY = event.clientY;

        return utils.prevent_default_events(event);
    }

    return true;
}

function stopDragScroll(){
    dragging = false;
}

function dragScroll(event) {
    if (!event)
        event = window.event;

    if (dragging === false)
        return true;

    event.cancelBubble = true;

    const inhalt = document.getElementById("side_content");
    const diff = startY - event.clientY;

    inhalt.scrollTop += diff;

    // Opera does not fire onunload event which is used to store the scroll
    // position. So call the store function manually here.
    if (utils.browser.is_opera())
        store_scroll_position();

    startY = event.clientY;

    dragging = event;
    return utils.prevent_default_events(event);
}

export function fold_sidebar()
{
    g_sidebar_folded = true;
    const sidebar = document.getElementById("check_mk_sidebar");
    sidebar.style.visibility = "hidden";
    sidebar.style.width = "10px";

    ajax.get_url("sidebar_fold.py?fold=yes");
}


function unfold_sidebar()
{
    g_sidebar_folded = false;
    const sidebar = document.getElementById("check_mk_sidebar");
    sidebar.style.removeProperty("visibility");
    sidebar.style.removeProperty("width");

    ajax.get_url("sidebar_fold.py?fold=");
}



/************************************************
 * Mausrad scrollen
 *************************************************/

function handle_scroll(delta) {
    scrolling = true;
    scroll_window(-delta*20);
    scrolling = false;
}

/** Event handler for mouse wheel event.
 */
function scrollWheel(event){
    // TODO: It's not reliable to detect the scrolling direction with wheel events:
    // https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent
    handle_scroll(event.deltaY < 0 ? 1: -1);

    // Opera does not fire onunload event which is used to store the scroll
    // position. So call the store function manually here.
    if (utils.browser.is_opera())
        store_scroll_position();
}


//
// Sidebar ajax stuff
//

// The refresh snapins do reload after a defined amount of time
var refresh_snapins = null;
// The restart snapins are notified about the restart of the nagios instance(s)
var restart_snapins = null;
// Contains a timestamp which holds the time of the last nagios restart handling
var sidebar_restart_time = null;
// Configures the number of seconds to reload all snapins which request it
var sidebar_update_interval = null;


export function add_snapin(name) {
    ajax.call_ajax("sidebar_ajax_add_snapin.py?name=" + name, {
        response_handler: function(_data, response) {
            const data = JSON.parse(response);
            if (data.result_code !== 0) {
                return;
            }

            const result = data.result;

            if (result.refresh) {
                const entry = [result.name, result.url];
                if (refresh_snapins.indexOf(entry) === -1) {
                    refresh_snapins.push(entry);
                }
            }

            if (result.restart) {
                const entry = result.name;
                if (restart_snapins.indexOf(entry) === -1) {
                    restart_snapins.push(entry);
                }
            }

            const sidebar_content = document.getElementById("side_content");
            if (sidebar_content) {
                var tmp = document.createElement("div");
                tmp.innerHTML = result.content;
                utils.execute_javascript_by_object(tmp);

                while (tmp.childNodes.length) {
                    sidebar_content.appendChild(tmp.childNodes[0]);
                }
            }

            const add_snapin_page = window.frames[0] ? window.frames[0].document : document;
            const preview = add_snapin_page.getElementById("snapin_container_" + name);
            if (preview) {
                const container = preview.parentElement.parentElement;
                container.remove();
            }
        }
    });
}

// Removes the snapin from the current sidebar and informs the server for persistance
export function remove_sidebar_snapin(oLink, url)
{
    const container = oLink.parentNode.parentNode.parentNode;
    const id = container.id.replace("snapin_container_", "");

    ajax.call_ajax(url, {
        handler_data     : "snapin_" + id,
        response_handler : function (id) {
            remove_snapin(id);
        },
        method           : "GET"
    });
}


// Removes a snapin from the sidebar without reloading anything
function remove_snapin(id)
{
    const container = document.getElementById(id).parentNode;
    const myparent = container.parentNode;
    myparent.removeChild(container);

    const name = id.replace("snapin_", "");

    const refresh_index = refresh_snapins.indexOf(name);
    if (refresh_index !== -1) {
        refresh_snapins.splice(refresh_index, 1);
    }

    const restart_index = restart_snapins.indexOf(name);
    if (restart_index !== -1) {
        restart_snapins.splice(refresh_index, 1);
    }

    // reload main frame if it is currently displaying the "add snapin" page
    if (parent.frames[0]) {
        const href = encodeURIComponent(parent.frames[0].location);
        if (href.indexOf("sidebar_add_snapin.py") > -1)
            parent.frames[0].location.reload();
    }
}


export function toggle_sidebar_snapin(oH2, url) {
    // oH2 can also be an <a>. In that case it is the minimize
    // image itself

    let childs;
    if (oH2.tagName == "A")
        childs = oH2.parentNode.parentNode.parentNode.childNodes;
    else
        childs = oH2.parentNode.parentNode.childNodes;

    let oContent, oHead;
    for (const i in childs) {
        const child = childs[i];
        if (child.tagName == "DIV" && child.className == "content")
            oContent = child;
        else if (child.tagName == "DIV" && (child.className == "head open" || child.className == "head closed"))
            oHead = child;
    }

    // FIXME: Does oContent really exist?
    const closed = oContent.style.display == "none";
    if (closed) {
        oContent.style.display = "block";
        utils.change_class(oHead, "closed", "open");
    }
    else {
        oContent.style.display = "none";
        utils.change_class(oHead, "open", "closed");
    }
    /* make this persistent -> save */
    ajax.get_url(url + (closed ? "open" : "closed"));
}

function reload_main_plus_sidebar() {
    window.top.location.reload();
}

// TODO move to managed/web/htdocs/js
export function switch_customer(customer_id, switch_state) {
    ajax.get_url("switch_customer.py?_customer_switch=" + customer_id + ":" + switch_state,
        reload_main_plus_sidebar, null);
}

export function switch_site(url) {
    ajax.get_url(url, reload_main_plus_sidebar, null);
}

function bulk_update_contents(ids, codes)
{
    codes = eval(codes);
    for (let i = 0; i < ids.length; i++) {
        if (restart_snapins.indexOf(ids[i].replace("snapin_", "")) !== -1) {
            // Snapins which rely on the restart time of nagios receive
            // an empty code here when nagios has not been restarted
            // since sidebar rendering or last update, skip it
            if(codes[i] !== "") {
                utils.update_contents(ids[i], codes[i]);
                sidebar_restart_time = Math.floor(Date.parse(new Date()) / 1000);
            }
        } else {
            utils.update_contents(ids[i], codes[i]);
        }
    }
}


var g_seconds_to_update = null;
var g_sidebar_scheduler_timer = null;

export function refresh_single_snapin(name) {
    const url = "sidebar_snapin.py?names=" + name;
    const ids = [ "snapin_" + name ];
    ajax.get_url(url, bulk_update_contents, ids);
}

export function reset_sidebar_scheduler() {
    if (g_sidebar_scheduler_timer !== null) {
        clearTimeout(g_sidebar_scheduler_timer);
        g_sidebar_scheduler_timer = null;
    }
    g_seconds_to_update = 1;
    execute_sidebar_scheduler();
}

export function execute_sidebar_scheduler() {
    if (g_seconds_to_update == null)
        g_seconds_to_update = sidebar_update_interval;
    else
        g_seconds_to_update -= 1;

    // Stop reload of the snapins in case the browser window / tab is not visible
    // for the user. Retry after short time.
    if (!utils.is_window_active()) {
        g_sidebar_scheduler_timer = setTimeout(function(){ execute_sidebar_scheduler(); }, 250);
        return;
    }

    const to_be_updated = [];

    let url;
    for (let i = 0; i < refresh_snapins.length; i++) {
        const name = refresh_snapins[i][0];
        if (refresh_snapins[i][1] != "") {
            // Special handling for snapins like the nagvis maps snapin which request
            // to be updated from a special URL, use direct update of those snapins
            // from this url
            url = refresh_snapins[i][1];

            if (g_seconds_to_update <= 0) {
                ajax.get_url(url, utils.update_contents, "snapin_" + name);
            }
        } else {
            // Internal update handling, use bulk update
            to_be_updated.push(name);
        }
    }

    // Are there any snapins to be bulk updates?
    if(to_be_updated.length > 0) {
        if (g_seconds_to_update <= 0) {
            url = "sidebar_snapin.py?names=" + to_be_updated.join(",");
            if (sidebar_restart_time !== null)
                url += "&since=" + sidebar_restart_time;

            const ids = [], len = to_be_updated.length;
            for (let i = 0; i < len; i++) {
                ids.push("snapin_" + to_be_updated[i]);
            }

            ajax.get_url(url, bulk_update_contents, ids);
        }
    }

    if (g_sidebar_notify_interval !== null) {
        const timestamp = Date.parse(new Date()) / 1000;
        if (timestamp % g_sidebar_notify_interval == 0) {
            update_messages();
        }
    }

    // Detect page changes and re-register the mousemove event handler
    // in the content frame. another bad hack ... narf
    if(is_content_frame_accessible() && g_content_loc != parent.frames[0].document.location.href) {
        register_edge_listeners(parent.frames[0]);
        update_content_location();
    }

    if (g_seconds_to_update <= 0)
        g_seconds_to_update = sidebar_update_interval;

    g_sidebar_scheduler_timer = setTimeout(function(){execute_sidebar_scheduler();}, 1000);
}

/************************************************
 * Save/Restore scroll position
 *************************************************/

function setCookie(cookieName, value,expiredays) {
    const exdate = new Date();
    exdate.setDate(exdate.getDate() + expiredays);
    document.cookie = cookieName + "=" + encodeURIComponent(value) +
        ((expiredays == null) ? "" : ";expires=" + exdate.toUTCString());
}

function getCookie(cookieName) {
    if(document.cookie.length == 0)
        return null;

    let cookieStart = document.cookie.indexOf(cookieName + "=");
    if(cookieStart == -1)
        return null;

    cookieStart = cookieStart + cookieName.length + 1;
    let cookieEnd = document.cookie.indexOf(";", cookieStart);
    if(cookieEnd == -1)
        cookieEnd = document.cookie.length;
    return decodeURIComponent(document.cookie.substring(cookieStart, cookieEnd));
}

export function initialize_scroll_position() {
    let scrollPos = getCookie("sidebarScrollPos");
    if(!scrollPos)
        scrollPos = 0;
    document.getElementById("side_content").scrollTop = scrollPos;
}

export function store_scroll_position() {
    setCookie("sidebarScrollPos", document.getElementById("side_content").scrollTop, null);
}

/************************************************
 * WATO Folders snapin handling
 *************************************************/

// FIXME: Make this somehow configurable - use the start url?
var g_last_view   = "dashboard.py?name=main";
var g_last_folder = "";

// highlight the followed link (when both needed snapins are available)
function highlight_link(link_obj, container_id) {
    const this_snapin = document.getElementById(container_id);
    let other_snapin;
    if (container_id == "snapin_container_wato_folders")
        other_snapin = document.getElementById("snapin_container_views");
    else
        other_snapin = document.getElementById("snapin_container_wato_folders");

    if (this_snapin && other_snapin) {
        let links;
        if (this_snapin.getElementsByClassName)
            links = this_snapin.getElementsByClassName("link");
        else
            links = document.getElementsByClassName("link", this_snapin);

        for (let i = 0; i < links.length; i++) {
            links[i].style.fontWeight = "normal";
        }

        link_obj.style.fontWeight = "bold";
    }
}

export function wato_folders_clicked(link_obj, folderpath) {
    g_last_folder = folderpath;
    highlight_link(link_obj, "snapin_container_wato_folders");
    parent.frames[0].location = g_last_view + "&wato_folder=" + encodeURIComponent(g_last_folder);
}

export function wato_views_clicked(link_obj) {
    g_last_view = link_obj.href;

    highlight_link(link_obj, "snapin_container_views");
    highlight_link(link_obj, "snapin_container_dashboards");

    if (g_last_folder != "") {
        // Navigate by using javascript, cancel following the default link
        parent.frames[0].location = g_last_view + "&wato_folder=" + encodeURIComponent(g_last_folder);
        return false;
    } else {
        // Makes use the url stated in href attribute
        return true;
    }
}

/************************************************
 * WATO Foldertree (Standalone) snapin handling
 *************************************************/

/* Foldable Tree in snapin */
export function wato_tree_click(link_obj, folderpath) {
    const topic  = document.getElementById("topic").value;
    const target = document.getElementById("target_" + topic).value;

    let href;
    if(target.substr(0, 9) == "dashboard") {
        const dashboard_name = target.substr(10, target.length);
        href = "dashboard.py?name=" + encodeURIComponent(dashboard_name);
    } else {
        href = "view.py?view_name=" + encodeURIComponent(target);
    }

    href += "&wato_folder=" + encodeURIComponent(folderpath);

    parent.frames[0].location = href;
}

export function wato_tree_topic_changed(topic_field) {
    // First toggle the topic dropdown field
    const topic = topic_field.value;

    // Hide all select fields but the wanted one
    const select_fields = document.getElementsByTagName("select");
    for(let i = 0; i < select_fields.length; i++) {
        if(select_fields[i].id && select_fields[i].id.substr(0, 7) == "target_") {
            select_fields[i].selected = "";
            if(select_fields[i].id == "target_" + topic) {
                select_fields[i].style.display = "inline";
            } else {
                select_fields[i].style.display = "none";
            }
        }
    }

    // Then send the info to python code via ajax call for persistance
    ajax.get_url("ajax_set_foldertree.py?topic=" + encodeURIComponent(topic) + "&target=");
}

export function wato_tree_target_changed(target_field) {
    const topic = target_field.id.substr(7, target_field.id.length);
    const target = target_field.value;

    // Send the info to python code via ajax call for persistance
    ajax.get_url("ajax_set_foldertree.py?topic=" + encodeURIComponent(topic) + "&target=" + encodeURIComponent(target));
}

/************************************************
 * Event console site selection
 *************************************************/

export function set_snapin_site(event, ident, select_field) {
    if (!event)
        event = window.event;

    ajax.get_url("sidebar_ajax_set_snapin_site.py?ident=" + encodeURIComponent(ident)
                 + "&site=" + encodeURIComponent(select_field.value), function(handler_data, response_body) {
                     refresh_single_snapin(ident);
                 }
                );
    return utils.prevent_default_events(event);
}

/************************************************
 * Render the nagvis snapin contents
 *************************************************/

export function fetch_nagvis_snapin_contents() {
    // Needs to be fetched via JS from NagVis because it needs to
    // be done in the user context.
    const nagvis_url = "../nagvis/server/core/ajax_handler.php?mod=Multisite&act=getMaps";
    ajax.call_ajax(nagvis_url, {
        add_ajax_id: false,
        response_handler: function (_unused_handler_data, ajax_response) {
            // Then hand over the data to the python code which is responsible
            // to render the data.
            ajax.call_ajax("ajax_nagvis_maps_snapin.py", {
                method: "POST",
                add_ajax_id: false,
                post_data: "request=" + encodeURIComponent(ajax_response),
                response_handler: function (_unused_handler_data, snapin_content_response) {
                    utils.update_contents("snapin_nagvis_maps", snapin_content_response);
                },
            });
        },
        error_handler: function (_unused, status_code) {
            const msg = document.createElement("div");
            msg.classList.add("message", "error");
            msg.innerHTML = "Failed to update NagVis maps: " + status_code;
            utils.update_contents("snapin_nagvis_maps", msg.outerHTML);
        },
        method: "GET"
    });
}

/************************************************
 * Bookmark snapin
 *************************************************/

export function add_bookmark() {
    const url = parent.frames[0].location;
    const title = parent.frames[0].document.title;
    ajax.get_url("add_bookmark.py?title=" + encodeURIComponent(title)
                 + "&url=" + encodeURIComponent(url), utils.update_contents, "snapin_bookmarks");
}

/************************************************
 * Wiki search snapin
 *************************************************/

export function wiki_search(omd_site) {
    const oInput = document.getElementById("wiki_search_field");
    top.frames["main"].location.href = "/" + encodeURIComponent(omd_site)
        + "/wiki/doku.php?do=search&id=" + escape(oInput.value);
    utils.prevent_default_events();
}


/************************************************
 * Wiki search snapin
 *************************************************/

var g_needle_timeout = null;

export function speedometer_show_speed(last_perc, program_start, scheduled_rate) {
    const url = "sidebar_ajax_speedometer.py" +
                           "?last_perc=" + last_perc +
                           "&scheduled_rate=" + scheduled_rate +
                           "&program_start=" + program_start;

    ajax.call_ajax(url, {
        response_handler: function(handler_data, response_body) {
            let data;
            try {
                data = JSON.parse(response_body);

                let oDiv = document.getElementById("speedometer");

                // Terminate reschedule when the speedometer div does not exist anymore
                // (e.g. the snapin has been removed)
                if (!oDiv)
                    return;

                oDiv.title = data.title;
                oDiv = document.getElementById("speedometerbg");
                oDiv.title = data.title;

                move_needle(data.last_perc, data.percentage); // 50 * 100ms = 5s = refresh time
            } catch(ie) {
                // Ignore errors during re-rendering. Proceed with reschedule...
                data = handler_data;
            }

            setTimeout(function(data) {
                return function() {
                    speedometer_show_speed(data.percentage, data.program_start, data.scheduled_rate);
                };
            }(data), 5000);
        },
        error_handler: function(handler_data, status_code, error_msg) {
            setTimeout(function(data) {
                return function() {
                    return speedometer_show_speed(data.percentage, data.program_start, data.scheduled_rate);
                };
            }(handler_data), 5000);
        },
        method: "GET",
        handler_data: {
            "percentage"     : last_perc,
            "last_perc"      : last_perc,
            "program_start"  : program_start,
            "scheduled_rate" : scheduled_rate
        }
    });
}

function show_speed(percentage) {
    const canvas = document.getElementById("speedometer");
    if (!canvas)
        return;

    const context = canvas.getContext("2d");
    if (!context)
        return;

    if (percentage > 100.0)
        percentage = 100.0;

    const orig_x = 116;
    const orig_y = 181;
    const angle_0   = 232.0;
    const angle_100 = 307.0;
    const angle = angle_0 + (angle_100 - angle_0) * percentage / 100.0;
    const angle_rad = angle / 360.0 * Math.PI * 2;
    const length = 120;
    const end_x = orig_x + (Math.cos(angle_rad) * length);
    const end_y = orig_y + (Math.sin(angle_rad) * length);

    context.clearRect(0, 0, 228, 136);
    context.beginPath();
    context.moveTo(orig_x, orig_y);
    context.lineTo(end_x, end_y);
    context.closePath();
    context.shadowOffsetX = 2;
    context.shadowOffsetY = 2;
    context.shadowBlur = 2;
    context.strokeStyle = "#000000";
    context.stroke();
}

function move_needle(from_perc, to_perc) {
    const new_perc = from_perc * 0.9 + to_perc * 0.1;

    show_speed(new_perc);

    if (g_needle_timeout != null)
        clearTimeout(g_needle_timeout);

    g_needle_timeout = setTimeout(function(new_perc, to_perc) {
        return function() {
            move_needle(new_perc, to_perc);
        };
    }(new_perc, to_perc), 50);
}

/************************************************
 * Popup Message Handling
 *************************************************/

// integer representing interval in seconds or <null> when disabled.
var g_sidebar_notify_interval;

export function init_messages(interval) {
    g_sidebar_notify_interval = interval;

    // Are there pending messages? Render the initial state of
    // trigger button
    update_message_trigger();
}

function handle_update_messages(_unused, code) {
    // add new messages to container
    const c = document.getElementById("messages");
    if (c) {
        c.innerHTML = code;
        utils.execute_javascript_by_object(c);
        update_message_trigger();
    }
}

function update_messages() {
    // Remove all pending messages from container
    const c = document.getElementById("messages");
    if (c) {
        c.innerHTML = "";
    }

    // retrieve new messages
    ajax.get_url("sidebar_get_messages.py", handle_update_messages);
}

function get_hint_messages(c) {
    let hints;
    if (c.getElementsByClassName)
        hints = c.getElementsByClassName("popup_msg");
    else
        hints = document.getElementsByClassName("popup_msg", c);
    return hints;
}

function update_message_trigger() {
    const c = document.getElementById("messages");
    if (c) {
        const b = document.getElementById("msg_button");
        const hints = get_hint_messages(c);
        if (hints.length > 0) {
            // are there pending messages? make trigger visible
            b.style.display = "inline";

            // Create/Update a blinking number label
            let l = document.getElementById("msg_label");
            if (!l) {
                l = document.createElement("span");
                l.setAttribute("id", "msg_label");
                b.appendChild(l);
            }

            l.innerHTML = "" + hints.length;
        } else {
            // no messages: hide the trigger
            b.style.display = "none";
        }
    }
}

export function mark_message_read(msg_id) {
    ajax.get_url("sidebar_message_read.py?id=" + msg_id);

    // Update the button state
    update_message_trigger();
}

export function read_message() {
    const c = document.getElementById("messages");
    if (!c)
        return;

    // extract message from the message container
    const hints = get_hint_messages(c);
    const msg = hints[0];
    c.removeChild(msg);

    // open the next message in a window
    c.parentNode.appendChild(msg);

    // tell server that the message has been read
    const msg_id = msg.id.replace("message-", "");
    mark_message_read(msg_id);
}

export function message_close(msg_id) {
    const m = document.getElementById("message-" + msg_id);
    if (m) {
        m.parentNode.removeChild(m);
    }
}
