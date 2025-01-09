class Cache {
  constructor (ttl, prefix) {
    this.prefix = prefix || 'asafonov.org'
    this.ttl = ttl || 3600000
  }
  set (name, value) {
    const ts = new Date().getTime()
    localStorage.setItem(this.prefix + name, JSON.stringify({ts, value}))
    return value
  }
  get (name) {
    const data = JSON.parse(localStorage.getItem(this.prefix + name))
    if (data && data.ts) {
      if (data.ts + this.ttl > new Date().getTime())
        return data.value
    }
    return
  }
  getItem (name) {
    const data = JSON.parse(localStorage.getItem(this.prefix + name))
    return data ? data.value : null
  }
  remove (name) {
    localStorage.removeItem(this.prefix + name)
  }
  destroy() {
    this.ttl = null
    this.prefix = null
  }
}
class Forecast {
  constructor (place) {
    const capitalize = v => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
    this.place = place.split(' ').map(i => capitalize(i)).join(' ')
  }
  getPlace() {
    return this.place
  }
  formatData (item) {
    return {
      temp: item.temp,
      time: item.date.substr(11),
      hour: item.date.substr(11, 2),
      day: item.date.substr(8, 2),
      wind_speed: item.wind_speed,
      wind_direction: item.wind_direction,
      pressure: item.pressure,
      humidity: item.humidity,
      clouds: item.clouds,
      rain: item.rain,
      snow: item.snow,
      description: item.description
    }
  }
  deleteCachedData() {
    asafonov.cache.remove(this.place)
  }
  getCachedData() {
    return asafonov.cache.getItem(this.place)
  }
  async getData() {
    let data = asafonov.cache.get(this.place)
    if (! data) {
      data = {hourly: [], daily: []}
      const url = `${asafonov.settings.apiUrl}/?place=${this.place}`
      try {
        const apiResp = await (await fetch(url)).json()
        const date = apiResp[0].date.substr(0, 10)
        let maxToday = apiResp[0].temp
        let minToday = apiResp[0].temp
        let prevDate = date
        for (let i = 1; i < apiResp.length; ++i) {
          let d = apiResp[i].date.substr(0, 10)
          let h = apiResp[i].date.substr(11, 2)
          if (d !== prevDate) {
            if (data.daily.length > 0) {
              const index = data.daily.length - 1
              if (data.daily[index].rain < 0.5) data.daily[index].rain = 0
              if (data.daily[index].snow < 0.5) data.daily[index].snow = 0
            }
            data.daily.push({rain: 0, snow: 0, clouds: 0, wind_speed: 0, day: apiResp[i].day, date: apiResp[i].date})
            prevDate = d
          }
          if (d === date) {
            maxToday = Math.max(apiResp[i].temp, maxToday)
            minToday = Math.min(apiResp[i].temp, minToday)
          } else {
            const index = data.daily.length - 1
            data.daily[index].rain = Math.max(apiResp[i].rain || 0, data.daily[index].rain)
            data.daily[index].snow = Math.max(apiResp[i].snow || 0, data.daily[index].snow)
            data.daily[index].wind_speed = Math.max(apiResp[i].wind_speed || 0, data.daily[index].wind_speed)
            data.daily[index].clouds += (apiResp[i].clouds || 0) / 8
            if (h >= '00' && h <= '08') {
              data.daily[index].morning = data.daily[index].morning !== undefined ? Math.min(data.daily[index].morning, apiResp[i].temp) : apiResp[i].temp
            }
            if (h > '08' && h <= '20') {
              data.daily[index].temp = data.daily[index].temp !== undefined ? Math.max(data.daily[index].temp, apiResp[i].temp) : apiResp[i].temp
              data.daily[index].wind_direction = apiResp[i].wind_direction
            }
            if (h > '20') {
              data.daily[index].evening = data.daily[index].evening !== undefined ? Math.min(data.daily[index].evening, apiResp[i].temp) : apiResp[i].temp
            }
          }
          if (i <= 16) {
            data.hourly.push(this.formatData(apiResp[i]))
          }
        }
        data.now = {
          ...this.formatData(apiResp[0]), ...{max: maxToday, min: minToday, timezone: apiResp[0].timezone}
        }
        asafonov.cache.set(this.getPlace(), data)
      } catch (e) {
        console.error(e)
        return
      }
    }
    return data
  }
  destroy() {
    this.place = null
  }
}
class MessageBus {
  constructor() {
    this.subscribers = {};
  }
  send (type, data) {
    if (this.subscribers[type] !== null && this.subscribers[type] !== undefined) {
      for (var i = 0; i < this.subscribers[type].length; ++i) {
        this.subscribers[type][i]['object'][this.subscribers[type][i]['func']](data);
      }
    }
  }
  subscribe (type, object, func) {
    if (this.subscribers[type] === null || this.subscribers[type] === undefined) {
      this.subscribers[type] = [];
    }
    this.subscribers[type].push({
      object: object,
      func: func
    });
  }
  unsubscribe (type, object, func) {
    if (this.subscribers[type] === null || this.subscribers[type] === undefined) return
    for (var i = 0; i < this.subscribers[type].length; ++i) {
      if (this.subscribers[type][i].object === object && this.subscribers[type][i].func === func) {
        this.subscribers[type].slice(i, 1);
        break;
      }
    }
  }
  unsubsribeType (type) {
    delete this.subscribers[type];
  }
  destroy() {
    for (type in this.subscribers) {
      this.unsubsribeType(type);
    }
    this.subscribers = null;
  }
}
class ControlView {
  constructor() {
    this.addEventListeners()
    this.container = document.querySelector('#forecast')
    this.navigationView = new NavigationView(this.container)
    this.forecastViews = []
    const cities = asafonov.cache.getItem('cities')
    if (cities && cities.length > 0) {
      for (let i = 0; i < cities.length; ++i) {
        this.forecastViews.push(new ForecastView(cities[i], this.container))
      }
      this.displayForecast()
    } else {
      const forecastView = new ForecastView(asafonov.settings.defaultCity, this.container)
      forecastView.display()
    }
  }
  getCurrentCityIndex() {
    let index = asafonov.cache.getItem('city')
    if (index === null || index ===undefined || index > this.forecastViews.length - 1) index = this.forecastViews.length - 1
    return index
  }
  displayForecast (index) {
    if (index === null || index === undefined) {
      index = this.getCurrentCityIndex()
    }
    if (index > -1) {
      asafonov.cache.set('city', index)
      this.forecastViews[index].display()
    }
  }
  addEventListeners() {
    asafonov.messageBus.subscribe(asafonov.events.CITY_ADDED, this, 'onCityAdded')
    asafonov.messageBus.subscribe(asafonov.events.CITY_SELECTED, this, 'onCitySelected')
    asafonov.messageBus.subscribe(asafonov.events.CITY_REMOVED, this, 'onCityRemoved')
  }
  removeEventListeners() {
    asafonov.messageBus.unsubscribe(asafonov.events.CITY_ADDED, this, 'onCityAdded')
    asafonov.messageBus.unsubscribe(asafonov.events.CITY_SELECTED, this, 'onCitySelected')
    asafonov.messageBus.unsubscribe(asafonov.events.CITY_REMOVED, this, 'onCityRemoved')
  }
  onCityAdded ({city}) {
    this.forecastViews.push(new ForecastView(city, this.container))
    this.displayForecast(this.forecastViews.length - 1)
  }
  onCitySelected ({index}) {
    this.displayForecast(index)
  }
  onCityRemoved({index}) {
    this.forecastViews[index].destroy()
    this.forecastViews[index] = null
    this.forecastViews.splice(index, 1)
    this.displayForecast()
  }
  destroy() {
    for (let i = 0; i < this.forecastViews.length; ++i) {
      this.forecastViews[i].destroy()
      this.forecastViews[i] = null
    }
    this.forecastViews = null
    this.navigationView.destroy()
    this.navigationView = null
    this.removeEventListeners()
  }
}
class ForecastView {
  constructor (place, container) {
    this.container = container
    this.model = new Forecast(place)
  }
  getPrecipIcons (value, iconNames) {
    const ret = []
    const values = [0, 0.25, 2.5, 8]
    for (let i = 0; i < values.length; ++i) {
      if (value > values[i]) ret.push(iconNames[i % iconNames.length])
    }
    return ret
  }
  getIconByData (data) {
    const icons = {main: []}
    if (data.rain && data.snow) {
      icons.main.push('cloud')
      const precipVariants = data.rain > data.snow ? ['raindrop', 'snowflake'] : ['snowflake', 'raindrop']
      icons.precip = this.getPrecipIcons(data.rain + data.snow, precipVariants)
    } else if (data.rain || data.snow) {
      icons.main.push('cloud')
      icons.precip = this.getPrecipIcons(data.rain, ['raindrop']).concat(this.getPrecipIcons(data.snow, ['snowflake']))
      return icons
    }
    icons.main.push(data.clouds > 75 ? 'cloudy' : data.hour >= '20' || data.hour < '08' ? 'moon' : 'sun')
    if (data.clouds >= 25 && data.clouds <= 75) icons.main.push('cloudy')
    if (data.wind_speed > 8) icons.main.push('wind')
    return icons
  }
  getIcon (icons) {
    let ret = ''
    if (icons.precip && icons.precip.length > 0) {
      ret += `<div class="icon_main"><svg><use xlink:href="#${icons.main[0]}"/></svg></div><div class="icon_precip">`
      for (let i = 0; i < icons.precip.length; ++i) {
        ret += `<svg><use xlink:href="#${icons.precip[i]}"/></svg>`
      }
      ret += '</div>'
      return [ret, ['icon_with_precip']]
    }
    for (let i = 0; i < icons.main.length; ++i) {
      ret += `<div class="icon_wrap"><svg><use xlink:href="#${icons.main[i]}"/></svg></div>`
    }
    const classes = []
    icons.main.length === 2 && classes.push('icon_double')
    icons.main.length === 3 && classes.push('icon_tripple')
    return [ret, classes]
  }
  getDayName (day, date) {
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    let ret = dayNames[day - 1]
    if (date) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const m = parseInt(date.substr(5, 2), 10)
      const d = date.substr(8, 2)
      ret += `,&nbsp;${monthNames[m - 1]}&nbsp;${d}`
    }
    return ret
  }
  async display() {
    this.container.querySelector('.city_name').innerHTML = this.model.getPlace()
    this.displayData(this.model.getCachedData())
    const data = await this.model.getData()
    this.displayData(data)
  }
  getCurrentTime (timezone) {
    return new Date(new Date().getTime() + (timezone || 0) * 1000).toISOString().substr(11, 5)
  }
  displayData (data) {
    if (! data) return
    this.container.querySelector('.temperature .now').innerHTML = `${data.now.temp}°`
    this.container.querySelector('.temperature .max').innerHTML = `${data.now.max}°`
    this.container.querySelector('.temperature .min').innerHTML = `${data.now.min}°`
    this.container.querySelector('.wind .wind_speed').innerHTML = data.now.wind_speed
    this.container.querySelector('.wind .wind_direction').innerHTML = data.now.wind_direction
    this.container.querySelector('.city_time').innerHTML = this.getCurrentTime(data.now.timezone)
    this.container.querySelector('.city_stats .description').innerHTML = data.now.description
    const icons = this.getIconByData(data.now)
    const iconDiv = this.container.querySelector('.icon_big')
    const [html, classes] = this.getIcon(icons)
    iconDiv.innerHTML = html
    classes.map(i => iconDiv.classList.add(i))
    const hourlyDiv = this.container.querySelector('.scroll_line')
    hourlyDiv.innerHTML = ''
    for (let i = 0; i < data.hourly.length; ++i) {
      const [html, classes] = this.getIcon(this.getIconByData(data.hourly[i]))
      hourlyDiv.innerHTML +=
        `<div class="item_scroll_line flex_col centered">
          <div class="text_accent">${data.hourly[i].hour}</div>
          <div class="icon_wrap icon_normal icon_scroll_line ${classes.join(' ')}">
            ${html}
          </div>
          <div class="text_h3">${data.hourly[i].temp}°</div>
        </div>`
    }
    const dailyDiv = this.container.querySelector('.days_list')
    dailyDiv.innerHTML = ''
    for (let i = 0; i < data.daily.length; ++i) {
      if (data.daily[i].evening === undefined || data.daily[i].evening === null) break
      const [html, classes] = this.getIcon(this.getIconByData(data.daily[i]))
      dailyDiv.innerHTML +=
        `<div class="item_days_list flex_row centered">
          <div class="day_name">${i === 0 ? 'Tomorrow' : this.getDayName(data.daily[i].day, data.daily[i].date)}</div>
          <div class="right_part flex_row centered">
            <div class="icon_wrap icon_normal ${classes.join(' ')}">
              ${html}
            </div>
            <div class="temperature flex_row">
              <div class="text_accent">${data.daily[i].morning}°</div>
              <div class="icon_wrap icon_small icon_opact">
                <svg>
                  <use xlink:href="#sun_up"/>
                </svg>
              </div>
              <div class="text_h3">${data.daily[i].temp}°</div>
              <div class="icon_wrap icon_small icon_opact">
                <svg>
                  <use xlink:href="#sun_down"/>
                </svg>
              </div>
              <div class="text_accent">${data.daily[i].evening}°</div>
            </div>
            <div class="wind flex_row centered">
              <div class="power">${data.daily[i].wind_speed}</div>
              <div class="direction flex_col centered">
                <div class="icon_wrap icon_fill icon_compas compas_se">
                  <svg>
                    <use xlink:href="#direction"/>
                  </svg>
                </div>
                <div class="text_small_dop">${data.daily[i].wind_direction}</div>
              </div>
            </div>
          </div>
        </div>`
    }
  }
  destroy() {
    this.container = null
    this.model.destroy()
    this.model = null
  }
}
class NavigationView {
 
  constructor (container) {
    const navigationContainer = container.querySelector('.navigation')
    this.addButton = navigationContainer.querySelector('.icon_add')
    this.listButton = navigationContainer.querySelector('.icon_list')
    this.pagesButtons = navigationContainer.querySelector('.pages')
    this.onAddClickProxy = this.onAddClick.bind(this)
    this.onListClickProxy = this.onListClick.bind(this)
    this.addEventListeners()
    this.updatePagesButtons()
  }
  updatePagesButtons (selected) {
    const cities = asafonov.cache.getItem('cities')
    const city = selected || asafonov.cache.getItem('city')
    this.listButton.style.opacity = cities && cities.length > 0 ? 1 : 0
    if (cities && cities.length > 1) {
      this.pagesButtons.style.opacity = 1
      this.pagesButtons.innerHTML = ''
      for (let i = 0; i < cities.length; ++i) {
        const div = document.createElement('div')
        div.className = 'icon_wrap icon_small icon_pages'
        if (i === city) div.id = 'selected_page'
        div.innerHTML = '<svg><use xlink:href="#pages"/></svg>'
        div.addEventListener('click', () => this.selectCity(i))
        this.pagesButtons.appendChild(div)
      }
    } else {
      this.pagesButtons.style.opacity = 0
    }
  }
  selectCity (index) {
    asafonov.messageBus.send(asafonov.events.CITY_SELECTED, {index})
    const pages = this.pagesButtons.querySelectorAll('.icon_pages')
    for (let i = 0; i < pages.length; ++i) {
      if (i === index) {
        pages[i].id = 'selected_page'
      } else {
        pages[i].removeAttribute('id')
      }
    }
  }
  async onAddClick() {
    let city = prompt('Please enter the city in English')
    if (city) {
      city = city.toLowerCase()
      const model = new Forecast(city)
      const data = await model.getData()
      if (data) {
        const cities = asafonov.cache.getItem('cities') || []
        if (cities.indexOf(city) === -1) {
          cities.push(city)
          asafonov.messageBus.send(asafonov.events.CITY_ADDED, {city})
          asafonov.cache.set('cities', cities)
          this.updatePagesButtons()
        }
      }
      model.destroy()
    }
  }
  onListClick() {
    if (confirm('Are you sure you want to delete current city?')) {
      const cities = asafonov.cache.getItem('cities')
      const city = asafonov.cache.getItem('city')
      const model = new Forecast(cities[city])
      model.deleteCachedData()
      model.destroy()
      cities.splice(city, 1)
      asafonov.cache.remove('city')
      if (cities.length > 0) {
        asafonov.cache.set('cities', cities)
      } else {
        asafonov.cache.remove('cities')
      }
      this.updatePagesButtons(cities.length -1)
      asafonov.messageBus.send(asafonov.events.CITY_REMOVED, {index: city})
    }
  }
  addEventListeners() {
    this.addButton.addEventListener('click', this.onAddClickProxy)
    this.listButton.addEventListener('click', this.onListClickProxy)
  }
  removeEventListeners() {
    this.addButton.removeEventListener('click', this.onAddClickProxy)
    this.listButton.removeEventListener('click', this.onListClickProxy)
  }
  destroy() {
    this.removeEventListeners()
    this.addButton = null
    this.pagesButtons.innerHTML = ''
    this.pagesButtons = null
  }
}
window.asafonov = {}
window.asafonov.version = '0.1'
window.asafonov.messageBus = new MessageBus()
window.asafonov.cache = new Cache(600000)
window.asafonov.events = {
  CITY_ADDED: 'CITY_ADDED',
  CITY_SELECTED: 'CITY_SELECTED',
  CITY_REMOVED: 'CITY_REMOVED'
}
window.asafonov.settings = {
  apiUrl: 'http://isengard.asafonov.org/api/v1/weather/',
  defaultCity: 'Moscow'
}
window.onerror = (msg, url, line) => {
  if (!! window.asafonov.debug) alert(`${msg} on line ${line}`)
}
document.addEventListener("DOMContentLoaded", function (event) {
  const view = new ControlView()
})
