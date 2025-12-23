# User script api reference | XBrowser 
This article organizes most of the Tampermonkey user script API usage and includes code examples for each method. In addition you can install [Tampermonkey user script API example](https://en.xbext.com/download/code/user-script-example.js) to test them in a browser that supports Tampermonkey user scripts.

> Tip: The API support and parameters described in the documentation are based on the built-in script manager of [XBrowser](https://en.xbext.com/), other script managers may have slight differences.

[](#Meta-data "Meta data")Meta data
-----------------------------------

Metadata is usually placed at the beginning of a script, and its main function is to declare, set, and describe the script, including the script name, introduction, author, version number, third-party library dependencies, and which APIs are used, etc.


The following are the metadata definition specifications supported by the Browser

* Tag: @name
  * Description: Name of the script
* Tag: @namespace
  * Description: The namespace of the script, either as a unique identifier or as a URL
* Tag: @description
  * Description: Introduction to the script describing the usage and functions of the script, etc.
* Tag: @icon
  * Description: Customize an icon for the script to be displayed in the script manager   as well as in the browser extension menu. This can be a url icon resource or a Base64 encoded Data URI.
* Tag: @author
  * Description: Name or nickname of the author of the script
* Tag: @version
  * Description: Current script version number
* Tag: @match
  * Description: Define the scope of the script to execute the script only at the matching URL or domain, this tag can have multiple lines declared in the metadata
* Tag: @include
  * Description: Similar to @match, it is used to describe the scope of a script and can have multiple lines of declaration in the metadata.
* Tag: @exclude
  * Description: Used to exclude some URLs, even if @match and @include have specified a match, there can be a multi-line declaration in the metadata.
* Tag: @require
  * Description: Specify third-party libraries that the script needs to depend on before it can be executed, and there can be a multi-line declaration in the metadata
* Tag: @resource
  * Description: The script execution needs to depend on some resource files, such as css, text, image resources, etc., which can be declared on multiple lines in the metadata
* Tag: @run-at
  * Description: Specify the timing of script execution, different scenarios may require different execution timing, where the value of @run-at can be found in the following table
* Tag: @grant
  * Description: Declare which API functions are used ,  there can be multiple lines in the metadata.


The metadata tag @run-at has the following attribute values.

* Value: document-start
  * Description: Specify that the script is executed at the beginning of the DOM tree, add this statement if you need the script to be executed early.
* Value: document-end
  * Description: Specify that the script is executed when the DOM data is loaded
* Value: document-idle
  * Description: Execute when the page is loaded. When the metadata does not have a @run-at declaration, the script is executed at this time by default.
* Value: main-menu
  * Description: Extension tag declaration for XBrowser, means that the script is not executed automatically but through the extended main menu option
* Value: context-menu
  * Description: Extension tag declaration for XBrowser,  means that the script is not executed automatically but through the extended long press menu option
* Value: tool-menu
  * Description: Extension tag declaration for XBrowser,  means that the script is not executed automatically but through the extended tools menu option


[](#User-Script-API "User Script API")User Script API
-----------------------------------------------------

### [](#GM-addStyle "GM_addStyle")GM\_addStyle

#### [](#Description "Description")Description

Adds a CSS style to the page.

#### [](#Syntax "Syntax")Syntax

```
function GM_addStyle (cssString)

```


#### [](#Parameters "Parameters")Parameters


|Name     |Type  |Description       |
|---------|------|------------------|
|cssString|String|Stylesheet strings|


#### [](#Example "Example")Example

```
GM.addStyle('#note{color: white; background: #3385ff!important;border-bottom: 1px solid #2d7');

```


### [](#GM-addElement "GM_addElement")GM\_addElement

#### [](#Description-1 "Description")Description

Add a page element that can specify a parent node without specifying the parent root node as its parent.

#### [](#Syntax-1 "Syntax")Syntax

```
function GM_addElement(tagName, attributes)

```


Or

```
function GM_addElement(parentNode,tagName, attributes)

```


#### [](#Parameters-1 "Parameters")Parameters


|Name      |Type  |Description                             |
|----------|------|----------------------------------------|
|tagName   |String|Name of element                         |
|attributes|Object|Property name/value pairs               |
|parentNode|Object|Parent node of the newly created element|


#### [](#Example-1 "Example")Example

```

GM_addElement('script', {
  textContent: 'window.foo = "bar";'
});

GM_addElement('script', {
  src: 'https://example.com/script.js',
  type: 'text/javascript'
});

GM_addElement(document.getElementsByTagName('div')
[0], 'img', {
  src: 'https://example.com/image.png'
});

GM_addElement(shadowDOM, 'style', {
  textContent: 'div { color: black; };'
});

```


### [](#GM-setValue "GM_setValue")GM\_setValue

#### [](#Description-2 "Description")Description

Save a key value/data to browser local storage.

#### [](#Syntax-2 "Syntax")Syntax

```
function GM_setValue(name,value)

```


#### [](#Parameters-2 "Parameters")Parameters


|Name |Type    |Description                                                                 |
|-----|--------|----------------------------------------------------------------------------|
|name |String  |Name of key                                                                 |
|value|Any type|Can be any data type such as integers, strings, boolean types, objects, etc.|


#### [](#Example-2 "Example")Example

```
GM_setValue("foo", "bar");
GM_setValue("count", 100);
GM_setValue("active", true);
GM_setValue("data", {
  name: 'Andy',
  age: 18
});

```


### [](#GM-getValue "GM_getValue")GM\_getValue

#### [](#Description-3 "Description")Description

Get data from browser local storage by specified key value

#### [](#Syntax-3 "Syntax")Syntax

```
function GM_getValue(name, defaultValue)

```


#### [](#Parameters-3 "Parameters")Parameters


|Name        |Type    |Description                                                            |
|------------|--------|-----------------------------------------------------------------------|
|name        |String  |Name of key                                                            |
|defaultValue|Any type|Optional, returns the default value if the key value has never been set|


#### [](#Return-Value "Return Value")Return Value

Returns the data that was originally set.

#### [](#Example-3 "Example")Example

```
GM_setValue("foo", "bar");
GM_setValue("count", 100);
GM_setValue("active", true);
GM_setValue("data", {
  name: 'Andy',
  age: 18
});

var info = `foo = ${GM_getValue("foo")}
          count = ${GM_getValue("count")}
          active = ${GM_getValue("active")}
          data.name =  ${GM_getValue("data").name}`;                   
alert(info);

```


### [](#GM-listValues "GM_listValues")GM\_listValues

#### [](#Description-4 "Description")Description

Returns the list of key values set using GM\_setValue.

#### [](#Syntax-4 "Syntax")Syntax

```
function GM_listValues()

```


#### [](#Example-4 "Example")Example

```
GM_setValue("foo", "bar");
GM_setValue("count", 100);
GM_setValue("active", true);
GM_setValue("data", {
name: 'Andy',
age: 18
});
alert(GM_listValues());

```


### [](#GM-deleteValue "GM_deleteValue")GM\_deleteValue

#### [](#Description-5 "Description")Description

Delete the key value set by the GM\_setValue method.

#### [](#Syntax-5 "Syntax")Syntax

```
function GM_deleteValue(name)

```


#### [](#Parameters-4 "Parameters")Parameters


|Name|Type  |Description|
|----|------|-----------|
|name|String|Name of key|


#### [](#Example-5 "Example")Example

```
GM_deleteValue("foo");

```


```
let keys =  GM_listValues();
for (let key of keys) {
  GM_deleteValue(key);
}

```


### [](#GM-notification "GM_notification")GM\_notification

#### [](#Description-6 "Description")Description

Display a notification message

#### [](#Syntax-6 "Syntax")Syntax

```
function GM_notification(details)

```


Or

```
function GM_notification(text, title, image, onclick )

```


#### [](#Parameters-5 "Parameters")Parameters



* Name: details
  * Type: Object
  * Description: An object containing a text field and ondone, onclick callback function fields
* Name: text
  * Type: String
  * Description: Text Content
* Name: title
  * Type: String
  * Description: Parameters are not currently implemented on the mobile side for compatibility
* Name: Image
  * Type: Object
  * Description: Parameters are not currently implemented on the mobile side for compatibility
* Name: onclick
  * Type: Callback function
  * Description: Callback function when the user has clicked the OK button


#### [](#Example-6 "Example")Example

```
GM_notification("Hello!");

GM.notification({
  text: 'This is a message with callback',
  onclick: function() {
    alert("you click message ok button");
  },
  ondone: function() {
    alert("message bar closed");
  }
});

GM_notification("Hello","","",function() {
  alert("you click message ok button");
})


```


### [](#GM-setClipboard "GM_setClipboard")GM\_setClipboard

#### [](#Description-7 "Description")Description

Write string data to the clipboard

#### [](#Syntax-7 "Syntax")Syntax

```
function GM_setClipboard(data)

```


#### [](#Parameters-6 "Parameters")Parameters


|Name|Type  |Description |
|----|------|------------|
|data|String|Text content|


#### [](#Example-7 "Example")Example

```
GM_setClipboard('this is test data');

```


### [](#GM-registerMenuCommand "GM_registerMenuCommand")GM\_registerMenuCommand

#### [](#Description-8 "Description")Description

Register a menu option, which will be displayed in the XBrowser’s Page Tools menu.

#### [](#Syntax-8 "Syntax")Syntax

```
function GM_registerMenuCommand(title,callback) 

```


#### [](#Parameters-7 "Parameters")Parameters


|Name    |Type             |Description                                          |
|--------|-----------------|-----------------------------------------------------|
|title   |String           |Menu item name                                       |
|callback|Callback function|Callback functions executed by clicking on menu items|


#### [](#Return-Value-1 "Return Value")Return Value

Returns the command ID of the menu item, which is used when un register of the menu

#### [](#Example-8 "Example")Example

```
GM_registerMenuCommand("click me",function() {
	alert("You click menu item");
});

```


### [](#GM-unregisterMenuCommand "GM_unregisterMenuCommand")GM\_unregisterMenuCommand

#### [](#Description-9 "Description")Description

Unregister previously registered menu items

#### [](#Syntax-9 "Syntax")Syntax

```
function GM_unregisterMenuCommand(commandId) 

```


#### [](#Parameters-8 "Parameters")Parameters


|Name     |Type  |Description                |
|---------|------|---------------------------|
|commandId|String|Command id of the menu item|


#### [](#Example-9 "Example")Example

```
GM_unregisterMenuCommand(commandId);

```


### [](#GM-openInTab "GM_openInTab")GM\_openInTab

#### [](#Description-10 "Description")Description

Open a page in a new tab

#### [](#Syntax-10 "Syntax")Syntax

```
function GM_openInTab(url,background) 

```


#### [](#Parameters-9 "Parameters")Parameters


|Name      |Type   |Description                                                |
|----------|-------|-----------------------------------------------------------|
|url       |String |URL of the new tab                                         |
|background|Boolean|Whether to open the tab in the background, default is false|


#### [](#Example-10 "Example")Example

```
GM_openInTab("https://www.example.com");
GM_openInTab("https://www.example.com",true);

```


### [](#GM-download "GM_download")GM\_download

#### [](#Description-11 "Description")Description

Call the browser’s default downloader to download

#### [](#Syntax-11 "Syntax")Syntax

```
function GM_download(url,name) 

```


Or

```
function GM_download(detail) 

```


#### [](#Parameters-10 "Parameters")Parameters


|Name  |Type  |Description                                       |
|------|------|--------------------------------------------------|
|url   |String|To download resources URL                         |
|name  |String|Name of the downloaded file                       |
|detail|Object|Configuring download parameters via detail objects|


##### [](#detail-property-list "detail  property list")detail property list

*   **url** - String type, indicating the URL to be downloaded
*   **name** - String type, name of the downloaded file
*   **confirm** - Boolean type, whether to pop up the download dialog, set this option to false when batch download
*   **tag** - Tagging of downloaded files . Files with the same tag are saved in the directory named after the tag.

#### [](#Example-11 "Example")Example

```
GM_download("https://www.xbext.com/download/xbrowser-release.apk") 

```


```

GM_download("https://www.xbext.com/download/xbrowser-release.apk,"xbrowser.apk");

```


```

let urls = ["https://www.dundeecity.gov.uk/sites/default/files/publications/civic_renewal_forms.zip",
            "https://www.dundeecity.gov.uk/sites/default/files/publications/civic_renewal_forms.zip",
            "https://www.dundeecity.gov.uk/sites/default/files/publications/civic_renewal_forms.zip",
           ];
var i =0;
for(let url of urls ) {
  GM_download({
    url: `${url}`,
    name: `test-file${++i}.zip`,
    confirm: false,
    tag: "test-file"
  });
}

```


### [](#GM-getResourceText "GM_getResourceText")GM\_getResourceText

#### [](#Description-12 "Description")Description

Get the content of the URL resource defined by the metadata tag @resource

#### [](#Syntax-12 "Syntax")Syntax

```
function GM_getResourceText(name)

```


#### [](#Parameters-11 "Parameters")Parameters


|Name|Type  |Description                                                              |
|----|------|-------------------------------------------------------------------------|
|name|String|The name of the key defined by the @resource tag to refer to the resource|


#### [](#Example-12 "Example")Example

```

var text = GM_getResourceText("main-content");

```


#### [](#Retun-value "Retun value")Retun value

Returns the text content of the resource URL.

### [](#GM-getResourceURL "GM_getResourceURL")GM\_getResourceURL

#### [](#Description-13 "Description")Description

Gets the content of the resource the metadata tag @resource referring , which is encoded in Base64 and formatted as a Data URI.

#### [](#Syntax-13 "Syntax")Syntax

```
function GM_getResourceURL(name)

```


#### [](#Parameters-12 "Parameters")Parameters


|Name|Type  |Description                                                              |
|----|------|-------------------------------------------------------------------------|
|name|String|The name of the key defined by the @resource tag to refer to the resource|


#### [](#Example-13 "Example")Example

```
var img = document.querySelector("#avatar")

img.src = GM_getResourceURL("avatar01");

```


#### [](#Return-value "Return value")Return value

Returns the Data URI encoded in Base64.

### [](#GM-xmlhttpRequest "GM_xmlhttpRequest")GM\_xmlhttpRequest

#### [](#Description-14 "Description")Description

This method is similar to the [XMLHttpRequest](http://developer.mozilla.org/en/docs/XMLHttpRequest) object, the difference is that this method supports cross-domain requests, breaking the [Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy), more flexible to use.

#### [](#Syntax-14 "Syntax")Syntax

```
function GM_xmlhttpRequest(details)

```


#### [](#Parameters-13 "Parameters")Parameters

This method has only one parameter of object type ，The list of properties of the object and their meanings are as follows.


|Name   |Type  |Description                                          |
|-------|------|-----------------------------------------------------|
|details|Object|Contains a series of properties as control parameters|


##### [](#details-properties "details properties")details properties

*   **method** - Http request method, GET, POST, HEAD, etc.，GET、POST、HEAD etc.
*   **url** - String，Target request URL.
*   **headers** - Optional, String, HTTP protocol header, User-Agent, Referer, etc.
*   **data** - Optional, string, data sent via POST method
*   **responseType** - Optional, string, the response type, which can be one of arraybuffer, blob, json and stream.
*   **onabort**\- Optionally, a callback function when the HTTP request is abort.
*   **onerror**\- Optional, callback function that is called when an exception occurs on an HTTP request
*   **onloadstart** - Optional, callback function where the HTTP request starts to be called
*   **onreadystatechange** - Optional, callback function that is called when the status of an HTTP request changes
*   **onload** - Optional, callback function that is called when the HTTP request is completed, the callback function parameter carries several properties as follows
    *   **finalUrl** - The URL address of the final HTTP request, such as the URL after a redirect.
    *   **readyState** - Integer type, request status
    *   **status** - HTTP Response Status
    *   **statusText** - The text corresponding to the HTTP response status
    *   **responseHeaders** - HTTP response headers
    *   **response** - The response object returned by the HTTP response，object type data, depending on the setting of the **responseType** field.
    *   **responseText** - The text content returned by the HTTP response

#### [](#示例 "示例")示例

```

GM_xmlhttpRequest({
  method: "GET",
  url: "http://www.example.com/",
  onload: function(response) {
    alert(response.responseText);
  }
});

```


```

GM.xmlHttpRequest({
  method: "POST",
  url: "https://www.example.net/login",
  data: "username=johndoe&password=xyz123",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded"
  },
  onload: function(response) {
    if (response.responseText.indexOf("Logged in as") > -1) {
      location.href = "http://www.example.net/dashboard";
    }
  }
});

```


### [](#GM-info "GM_info")GM\_info

This is an object that holds the environment variables associated with each script, such as the script’s version, author, introduction, etc. The list of object properties is as follows.

*   **script** - Object type, contains some of the following properties.
    
    *   **author** - Author of this script
    *   **name** - Name of this script
    *   **description** - Script Description
    *   **version** - Version
    *   **copyright** - Copyright Information
    *   **includes** - Array type, list of matching pages
    *   **matches** - Array type, similar to includes, matching the list of pages
    *   **excludes** - Array type, exclude URL list
    *   **resources** - Array type, resource list
*   **version** - Version of Script Manager
    
*   **scriptHandler** - Name of the script manager
    
*   **scriptMetaStr** - Script Manager Metadata String
    

#### [](#Example-14 "Example")Example

```
var info = "Script Name: "  + GM_info.script.name + 
    "\nVersion: " + GM_info.script.version + 
    "\nVersion: " + GM_info.script.version + 
    "\nScriptHandler: " + GM_info.scriptHandler + 
    "\nScript Handler Version : " + GM_info.version ;

alert(info);

```


[](#References "References")References
--------------------------------------

*   [https://www.tampermonkey.net/documentation.php](https://www.tampermonkey.net/documentation.php)
    
*   [https://wiki.greasespot.net/Greasemonkey\_Manual:API](https://wiki.greasespot.net/Greasemonkey_Manual:API)
    
*   [https://github.com/examplecode/user-script-example](https://github.com/examplecode/user-script-example)